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
