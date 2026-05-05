package services

import (
	"fmt"
	"strings"
	"testing"

	"github.com/apache/apisix-dashboard/api/internal/models"
)

func TestSlugFromDisplayName(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"simple", "Environment", "environment"},
		{"with spaces", "API Version", "api_version"},
		{"with hyphens", "team-name", "team_name"},
		{"with special chars", "My Team!@#$%", "my_team"},
		{"long name", strings.Repeat("a", 50), strings.Repeat("a", 32)},
		{"empty", "", ""},
		{"numbers", "Version 2", "version_2"},
		{"mixed", "Dev-Ops Team 1", "dev_ops_team_1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := SlugFromDisplayName(tt.input)
			if got != tt.expected {
				t.Errorf("SlugFromDisplayName(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestLabelKeyRegex(t *testing.T) {
	valid := []string{"env", "team", "api_version", "a", "a123", "a_b_c"}
	invalid := []string{"", "ENV", "123abc", "_env", "env-name", "env.name", strings.Repeat("a", 33), "env name"}

	for _, k := range valid {
		if !labelKeyRegex.MatchString(k) {
			t.Errorf("expected %q to be valid label key", k)
		}
	}
	for _, k := range invalid {
		if labelKeyRegex.MatchString(k) {
			t.Errorf("expected %q to be invalid label key", k)
		}
	}
}

func TestValidateLabel(t *testing.T) {
	svc := &LabelService{}

	tests := []struct {
		name    string
		label   models.Label
		wantErr bool
		errIs   error
		errMsg  string
	}{
		{
			name: "valid label",
			label: models.Label{
				Key: "env", DisplayName: "Environment", Color: "#4263eb",
				Values: []string{"production", "staging"},
			},
		},
		{
			name: "valid label no values",
			label: models.Label{
				Key: "env", DisplayName: "Environment", Color: "#4263eb",
			},
		},
		{
			name: "invalid key uppercase",
			label: models.Label{
				Key: "ENV", DisplayName: "Environment", Color: "#4263eb",
			},
			wantErr: true, errIs: ErrInvalidLabelKey,
		},
		{
			name: "invalid key starts with number",
			label: models.Label{
				Key: "1env", DisplayName: "Environment", Color: "#4263eb",
			},
			wantErr: true, errIs: ErrInvalidLabelKey,
		},
		{
			name: "invalid key too long",
			label: models.Label{
				Key: strings.Repeat("a", 33), DisplayName: "Long", Color: "#4263eb",
			},
			wantErr: true, errIs: ErrInvalidLabelKey,
		},
		{
			name: "invalid key with hyphen",
			label: models.Label{
				Key: "my-key", DisplayName: "My Key", Color: "#4263eb",
			},
			wantErr: true, errIs: ErrInvalidLabelKey,
		},
		{
			name: "empty display name",
			label: models.Label{
				Key: "env", DisplayName: "", Color: "#4263eb",
			},
			wantErr: true, errMsg: "1-64 characters",
		},
		{
			name: "display name too long",
			label: models.Label{
				Key: "env", DisplayName: strings.Repeat("a", 65), Color: "#4263eb",
			},
			wantErr: true, errMsg: "1-64 characters",
		},
		{
			name: "value with colon",
			label: models.Label{
				Key: "env", DisplayName: "Environment", Color: "#4263eb",
				Values: []string{"prod:v1"},
			},
			wantErr: true, errIs: ErrInvalidLabelValue,
		},
		{
			name: "value too long",
			label: models.Label{
				Key: "env", DisplayName: "Environment", Color: "#4263eb",
				Values: []string{strings.Repeat("x", 65)},
			},
			wantErr: true, errIs: ErrInvalidLabelValue,
		},
		{
			name: "empty value string",
			label: models.Label{
				Key: "env", DisplayName: "Environment", Color: "#4263eb",
				Values: []string{""},
			},
			wantErr: true, errIs: ErrInvalidLabelValue,
		},
		{
			name: "duplicate values case insensitive",
			label: models.Label{
				Key: "env", DisplayName: "Environment", Color: "#4263eb",
				Values: []string{"Production", "production"},
			},
			wantErr: true, errMsg: "duplicate",
		},
		{
			name: "max length display name is valid",
			label: models.Label{
				Key: "env", DisplayName: strings.Repeat("a", 64), Color: "#4263eb",
			},
		},
		{
			name: "max length key is valid",
			label: models.Label{
				Key: "a" + strings.Repeat("b", 31), DisplayName: "Test", Color: "#4263eb",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := svc.validateLabel(&tt.label)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				if tt.errIs != nil && err != tt.errIs {
					t.Errorf("expected error %v, got %v", tt.errIs, err)
				}
				if tt.errMsg != "" && !strings.Contains(err.Error(), tt.errMsg) {
					t.Errorf("expected error containing %q, got %q", tt.errMsg, err.Error())
				}
			} else if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

func TestValidateRouteLabels(t *testing.T) {
	taxonomy := map[string]*models.Label{
		"env": {
			Key: "env", DisplayName: "Environment", Color: "#4263eb",
			Values: []string{"production", "staging", "development"},
		},
		"team": {
			Key: "team", DisplayName: "Team", Color: "#40c057",
			Values: []string{"payments", "platform"},
		},
	}

	tests := []struct {
		name    string
		labels  map[string]string
		wantErr bool
		errMsg  string
	}{
		{
			name:   "valid labels",
			labels: map[string]string{"env": "production", "team": "payments"},
		},
		{
			name:    "unknown key",
			labels:  map[string]string{"unknown": "value"},
			wantErr: true, errMsg: "not defined",
		},
		{
			name:    "invalid value",
			labels:  map[string]string{"env": "invalid"},
			wantErr: true, errMsg: "not an allowed value",
		},
		{
			name:   "case insensitive value",
			labels: map[string]string{"env": "Production"},
		},
		{
			name:   "empty labels",
			labels: map[string]string{},
		},
		{
			name:   "nil labels",
			labels: nil,
		},
		{
			name:   "single valid label",
			labels: map[string]string{"team": "platform"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateLabelsAgainstTaxonomy(tt.labels, taxonomy)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				if tt.errMsg != "" && !strings.Contains(err.Error(), tt.errMsg) {
					t.Errorf("expected error containing %q, got %q", tt.errMsg, err.Error())
				}
			} else if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

// validateLabelsAgainstTaxonomy extracts the core validation logic for testing
// without requiring an etcd connection. Mirrors the logic in LabelService.ValidateRouteLabels.
func validateLabelsAgainstTaxonomy(labels map[string]string, taxMap map[string]*models.Label) error {
	if len(labels) == 0 {
		return nil
	}
	for k, v := range labels {
		def, ok := taxMap[k]
		if !ok {
			return fmt.Errorf("invalid label: key '%s' is not defined in the label taxonomy", k)
		}
		found := false
		for _, allowed := range def.Values {
			if strings.EqualFold(allowed, v) {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("invalid label value: '%s' is not an allowed value for key '%s'. Allowed: %s", v, k, strings.Join(def.Values, ", "))
		}
	}
	return nil
}
