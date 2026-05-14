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
