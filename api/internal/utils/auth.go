package utils

import "strings"

// MatchPathPrefix checks if the given path starts with any of the allowed prefixes
func MatchPathPrefix(path string, prefixes []string) bool {
	if len(prefixes) == 0 {
		return true
	}

	for _, prefix := range prefixes {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}
	return false
}

// MatchTags checks if the resource tags overlap with the allowed user scope tags
func MatchTags(resourceTags []string, allowedTags []string) bool {
	if len(allowedTags) == 0 {
		return true
	}

	// Create a map for efficient lookup
	tagMap := make(map[string]bool)
	for _, t := range resourceTags {
		tagMap[t] = true
	}

	for _, t := range allowedTags {
		if tagMap[t] {
			return true
		}
	}
	return false
}
