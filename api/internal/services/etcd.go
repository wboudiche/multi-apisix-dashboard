// Licensed to the Apache Software Foundation (ASF) under one or more
// contributor license agreements.  See the NOTICE file distributed with
// this work for additional information regarding copyright ownership.
// The ASF licenses this file to You under the Apache License, Version 2.0
// (the "License"); you may not use this file except in compliance with
// the License.  You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package services

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/config"

	"go.etcd.io/etcd/client/v3"
)

type EtcdClient struct {
	client *clientv3.Client
	prefix string
}

func NewEtcdClient(cfg config.EtcdConfig) (*EtcdClient, error) {
	cli, err := clientv3.New(clientv3.Config{
		Endpoints:   cfg.Endpoints,
		Username:    cfg.Username,
		Password:    cfg.Password,
		DialTimeout: 5 * time.Second,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to etcd: %w", err)
	}

	return &EtcdClient{
		client: cli,
		prefix: cfg.Prefix,
	}, nil
}

func (e *EtcdClient) Close() error {
	return e.client.Close()
}

func (e *EtcdClient) key(path string) string {
	return e.prefix + path
}

// Get retrieves a value by key
func (e *EtcdClient) Get(ctx context.Context, key string) ([]byte, error) {
	resp, err := e.client.Get(ctx, e.key(key))
	if err != nil {
		return nil, err
	}
	if len(resp.Kvs) == 0 {
		return nil, nil
	}
	return resp.Kvs[0].Value, nil
}

// Put sets a key-value pair
func (e *EtcdClient) Put(ctx context.Context, key string, value []byte) error {
	_, err := e.client.Put(ctx, e.key(key), string(value))
	return err
}

// Delete removes a key
func (e *EtcdClient) Delete(ctx context.Context, key string) error {
	_, err := e.client.Delete(ctx, e.key(key))
	return err
}

// DeletePrefix removes every key under a prefix in a single operation
func (e *EtcdClient) DeletePrefix(ctx context.Context, prefix string) error {
	_, err := e.client.Delete(ctx, e.key(prefix), clientv3.WithPrefix())
	return err
}

// List lists all keys with a prefix
func (e *EtcdClient) List(ctx context.Context, prefix string) (map[string][]byte, error) {
	resp, err := e.client.Get(ctx, e.key(prefix), clientv3.WithPrefix())
	if err != nil {
		return nil, err
	}

	result := make(map[string][]byte)
	for _, kv := range resp.Kvs {
		// Remove prefix from key
		key := string(kv.Key)[len(e.prefix):]
		result[key] = kv.Value
	}
	return result, nil
}

// ListWithRevisions lists all keys with a prefix, and the revision each was
// last written at, for a delete that must not remove a newer write.
func (e *EtcdClient) ListWithRevisions(ctx context.Context, prefix string) (map[string][]byte, map[string]int64, error) {
	resp, err := e.client.Get(ctx, e.key(prefix), clientv3.WithPrefix())
	if err != nil {
		return nil, nil, err
	}

	values := make(map[string][]byte, len(resp.Kvs))
	revisions := make(map[string]int64, len(resp.Kvs))
	for _, kv := range resp.Kvs {
		key := string(kv.Key)[len(e.prefix):]
		values[key] = kv.Value
		revisions[key] = kv.ModRevision
	}
	return values, revisions, nil
}

// DeleteIfUnchanged deletes a key only if it has not been written since
// modRevision, in one transaction. It reports whether it deleted the key, and,
// when it did not, whether the key is still there at all.
func (e *EtcdClient) DeleteIfUnchanged(ctx context.Context, key string, modRevision int64) (deleted, exists bool, err error) {
	resp, err := e.client.Txn(ctx).
		If(clientv3.Compare(clientv3.ModRevision(e.key(key)), "=", modRevision)).
		Then(clientv3.OpDelete(e.key(key))).
		Else(clientv3.OpGet(e.key(key), clientv3.WithKeysOnly())).
		Commit()
	if err != nil {
		return false, false, err
	}
	if resp.Succeeded {
		return true, true, nil
	}
	return false, len(resp.Responses[0].GetResponseRange().Kvs) > 0, nil
}

// GetJSON retrieves and unmarshals a JSON object
func (e *EtcdClient) GetJSON(ctx context.Context, key string, dest interface{}) error {
	value, err := e.Get(ctx, key)
	if err != nil {
		return err
	}
	if value == nil {
		return nil
	}
	return json.Unmarshal(value, dest)
}

// PutJSON marshals and stores a JSON object
func (e *EtcdClient) PutJSON(ctx context.Context, key string, value interface{}) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return e.Put(ctx, key, data)
}

// PutJSONIfAbsent writes a JSON object only if the key has none, in one
// transaction, and reports whether it wrote.
func (e *EtcdClient) PutJSONIfAbsent(ctx context.Context, key string, value interface{}) (bool, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return false, err
	}
	resp, err := e.client.Txn(ctx).
		If(clientv3.Compare(clientv3.CreateRevision(e.key(key)), "=", 0)).
		Then(clientv3.OpPut(e.key(key), string(data))).
		Commit()
	if err != nil {
		return false, err
	}
	return resp.Succeeded, nil
}

// CheckConnection tests the connection to etcd
func (e *EtcdClient) CheckConnection(ctx context.Context) error {
	_, err := e.client.Get(ctx, "health")
	if err != nil {
		// Try with prefix
		_, err = e.client.Get(ctx, e.prefix+"/test", clientv3.WithLimit(1))
	}
	return err
}
