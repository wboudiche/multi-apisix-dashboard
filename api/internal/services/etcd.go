package services

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/apache/apisix-dashboard/api/internal/config"

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
		DialTimeout: 5 * 1000000000, // 5 seconds
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

// CheckConnection tests the connection to etcd
func (e *EtcdClient) CheckConnection(ctx context.Context) error {
	_, err := e.client.Get(ctx, "health")
	if err != nil {
		// Try with prefix
		_, err = e.client.Get(ctx, e.prefix+"/test", clientv3.WithLimit(1))
	}
	return err
}
