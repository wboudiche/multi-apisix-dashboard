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
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

var (
	ErrLabelNotFound     = fmt.Errorf("label not found")
	ErrLabelExists       = fmt.Errorf("label key already exists")
	ErrInvalidLabelKey   = fmt.Errorf("label key must be lowercase alphanumeric with underscores, max 32 chars")
	ErrInvalidLabelValue = fmt.Errorf("label values must be max 64 chars, no colons, unique within key")
)

var labelKeyRegex = regexp.MustCompile(`^[a-z][a-z0-9_]{0,31}$`)

// LabelService keeps each instance's label catalogue: the keys and values
// offered when filtering resources by label. It is a guide, not a rule: the
// labels a resource carries are not checked against it - the route form takes
// any key and value, and the importers write labels of their own - and the
// filter offers labels in use beside the catalogue (#190, #397).
type LabelService struct {
	etcd *EtcdClient
}

func NewLabelService(etcd *EtcdClient) *LabelService {
	return &LabelService{etcd: etcd}
}

func (s *LabelService) labelKey(instanceID, key string) string {
	return models.KeyPrefixLabels + instanceID + "/" + key
}

func (s *LabelService) labelPrefix(instanceID string) string {
	return models.KeyPrefixLabels + instanceID + "/"
}

// SlugFromDisplayName generates a key slug from a display name
func SlugFromDisplayName(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		} else if r == ' ' || r == '-' {
			b.WriteRune('_')
		}
	}
	result := b.String()
	if len(result) > 32 {
		result = result[:32]
	}
	return result
}

func (s *LabelService) validateLabel(label *models.Label) error {
	if !labelKeyRegex.MatchString(label.Key) {
		return ErrInvalidLabelKey
	}
	if len(label.DisplayName) == 0 || len(label.DisplayName) > 64 {
		return fmt.Errorf("display name must be 1-64 characters")
	}
	seen := make(map[string]bool)
	for _, v := range label.Values {
		if len(v) == 0 || len(v) > 64 {
			return ErrInvalidLabelValue
		}
		if strings.Contains(v, ":") {
			return ErrInvalidLabelValue
		}
		lower := strings.ToLower(v)
		if seen[lower] {
			return fmt.Errorf("duplicate label value: %s", v)
		}
		seen[lower] = true
	}
	return nil
}

func (s *LabelService) CreateLabel(ctx context.Context, instanceID string, label *models.Label) error {
	if err := s.validateLabel(label); err != nil {
		return err
	}

	existing, _ := s.GetLabel(ctx, instanceID, label.Key)
	if existing != nil {
		return ErrLabelExists
	}

	now := time.Now().Unix()
	label.CreatedAt = now
	label.UpdatedAt = now

	return s.etcd.PutJSON(ctx, s.labelKey(instanceID, label.Key), label)
}

func (s *LabelService) GetLabel(ctx context.Context, instanceID, key string) (*models.Label, error) {
	var label models.Label
	err := s.etcd.GetJSON(ctx, s.labelKey(instanceID, key), &label)
	if err != nil {
		return nil, err
	}
	if label.Key == "" {
		return nil, nil
	}
	return &label, nil
}

func (s *LabelService) ListLabels(ctx context.Context, instanceID string) ([]*models.Label, error) {
	data, err := s.etcd.List(ctx, s.labelPrefix(instanceID))
	if err != nil {
		return nil, err
	}

	labels := make([]*models.Label, 0, len(data))
	for _, d := range data {
		var label models.Label
		if err := json.Unmarshal(d, &label); err != nil {
			continue
		}
		labels = append(labels, &label)
	}

	sort.Slice(labels, func(i, j int) bool {
		return labels[i].Key < labels[j].Key
	})

	return labels, nil
}

func (s *LabelService) UpdateLabel(ctx context.Context, instanceID string, label *models.Label) error {
	if err := s.validateLabel(label); err != nil {
		return err
	}

	existing, _ := s.GetLabel(ctx, instanceID, label.Key)
	if existing == nil {
		return ErrLabelNotFound
	}

	label.CreatedAt = existing.CreatedAt
	label.CreatedBy = existing.CreatedBy
	label.UpdatedAt = time.Now().Unix()

	return s.etcd.PutJSON(ctx, s.labelKey(instanceID, label.Key), label)
}

func (s *LabelService) DeleteLabel(ctx context.Context, instanceID, key string) error {
	existing, _ := s.GetLabel(ctx, instanceID, key)
	if existing == nil {
		return ErrLabelNotFound
	}
	return s.etcd.Delete(ctx, s.labelKey(instanceID, key))
}
