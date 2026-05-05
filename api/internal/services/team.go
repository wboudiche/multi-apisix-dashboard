package services

import (
	"context"
	"encoding/json"

	"github.com/apache/apisix-dashboard/api/internal/models"
	"github.com/google/uuid"
)

type TeamService struct {
	etcd *EtcdClient
}

func NewTeamService(etcd *EtcdClient) *TeamService {
	return &TeamService{
		etcd: etcd,
	}
}

// CreateTeam creates a new team
func (s *TeamService) CreateTeam(ctx context.Context, team *models.Team) error {
	if team.ID == "" {
		team.ID = uuid.New().String()
	}

	return s.etcd.PutJSON(ctx, models.KeyPrefixTeams+team.ID, team)
}

// GetTeam retrieves a team by ID
func (s *TeamService) GetTeam(ctx context.Context, id string) (*models.Team, error) {
	var team models.Team
	err := s.etcd.GetJSON(ctx, models.KeyPrefixTeams+id, &team)
	if err != nil {
		return nil, err
	}
	if team.ID == "" {
		return nil, nil // Not found
	}
	return &team, nil
}

// ListTeams lists all teams
func (s *TeamService) ListTeams(ctx context.Context) ([]models.Team, error) {
	teamsMap, err := s.etcd.List(ctx, models.KeyPrefixTeams)
	if err != nil {
		return nil, err
	}

	teams := make([]models.Team, 0)
	for _, data := range teamsMap {
		var team models.Team
		if err := json.Unmarshal(data, &team); err == nil {
			teams = append(teams, team)
		}
	}
	return teams, nil
}

// UpdateTeam updates an existing team
func (s *TeamService) UpdateTeam(ctx context.Context, team *models.Team) error {
	return s.etcd.PutJSON(ctx, models.KeyPrefixTeams+team.ID, team)
}

// DeleteTeam removes a team
func (s *TeamService) DeleteTeam(ctx context.Context, id string) error {
	return s.etcd.Delete(ctx, models.KeyPrefixTeams+id)
}
