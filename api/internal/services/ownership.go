package services

import (
	"context"
	"encoding/json"

	"github.com/apache/apisix-dashboard/api/internal/models"
)

type OwnershipService struct {
	etcd *EtcdClient
}

func NewOwnershipService(etcd *EtcdClient) *OwnershipService {
	return &OwnershipService{
		etcd: etcd,
	}
}

// SetOwner sets the team owner for a resource on an instance
func (s *OwnershipService) SetOwner(ctx context.Context, o *models.Ownership) error {
	key := models.KeyPrefixOwnership + o.InstanceID + "/" + o.ResourceType + "/" + o.ResourceID
	return s.etcd.PutJSON(ctx, key, o.TeamID)
}

// GetOwner retrieves the team ID that owns a resource
func (s *OwnershipService) GetOwner(ctx context.Context, instanceID, resourceType, resourceID string) (string, error) {
	var teamID string
	key := models.KeyPrefixOwnership + instanceID + "/" + resourceType + "/" + resourceID
	err := s.etcd.GetJSON(ctx, key, &teamID)
	return teamID, err
}

// DeleteOwner removes ownership metadata
func (s *OwnershipService) DeleteOwner(ctx context.Context, instanceID, resourceType, resourceID string) error {
	key := models.KeyPrefixOwnership + instanceID + "/" + resourceType + "/" + resourceID
	return s.etcd.Delete(ctx, key)
}

// ListOwnersByResourceType returns a map of resourceID -> teamID for all resources
// of a given type on an instance, using a single etcd prefix scan.
func (s *OwnershipService) ListOwnersByResourceType(ctx context.Context, instanceID, resourceType string) (map[string]string, error) {
	prefix := models.KeyPrefixOwnership + instanceID + "/" + resourceType + "/"
	resp, err := s.etcd.List(ctx, prefix)
	if err != nil {
		return nil, err
	}
	result := make(map[string]string, len(resp))
	for key, val := range resp {
		// key is like /ownership/{instanceID}/{resourceType}/{resourceID}
		// Extract resourceID as the last segment
		parts := splitLast(key, "/")
		if parts == "" {
			continue
		}
		var teamID string
		if jsonErr := json.Unmarshal(val, &teamID); jsonErr == nil {
			result[parts] = teamID
		}
	}
	return result, nil
}

func splitLast(s, sep string) string {
	i := len(s) - 1
	for i >= 0 && s[i] != sep[0] {
		i--
	}
	if i < 0 {
		return s
	}
	return s[i+1:]
}

// CountByTeam counts how many resources are owned by a given team
func (s *OwnershipService) CountByTeam(ctx context.Context, teamID string) (int, error) {
	resp, err := s.etcd.List(ctx, models.KeyPrefixOwnership)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, val := range resp {
		// Values are stored as JSON-encoded strings (e.g., "\"team-id\"")
		var storedTeamID string
		if jsonErr := json.Unmarshal(val, &storedTeamID); jsonErr == nil {
			if storedTeamID == teamID {
				count++
			}
		}
	}
	return count, nil
}
