/**
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * The files locale-keys.test.ts cannot read a key out of.
 *
 * Every key `en` has must exist in every language: that is one check over the
 * five bundles, and needs no list (#362). What still goes file by file is the
 * source: every dotted string a file spells is held to being a key `en` holds,
 * so that a key mistyped inside a ternary - which eslint's i18n/no-unknown-key
 * does not descend into - is reported by name, and a key held in a variable is
 * refused, since nothing could check it. Both began as a list of screens that
 * had been worked through (#328) and now cover all of src/, so this names what
 * they cannot read, with the reason, rather than what they do.
 *
 * Two shapes are here. A file that builds a key from a variable, where that is
 * the design: the keys it can reach are either enumerated for the test by the
 * module itself (role-labels.ts exports `roleLabelKeys`) or, for a plugin
 * category or a navigation label, are every key under a prefix, and held by
 * the bundle check like any other. And a file whose dotted strings are field
 * paths - `checks.active.timeout`, `tls.verify` - or protocol names, which
 * the check would read as keys `en` does not hold.
 */
export const KEYS_NOT_READABLE = [
  // Keys built from a variable.
  'src/components/Navbar.tsx', // `sources.${route.label}`
  'src/components/form-slice/FormItemPlugins/PluginCard.tsx', // `form.plugins.category.${category}`
  'src/components/form-slice/FormItemPlugins/PluginEditorDrawer.tsx',
  'src/components/form-slice/FormItemPlugins/SelectPluginsDrawer.tsx',
  'src/components/form-slice/FormPartBasic.tsx', // `form.basic.statusOption.${status}`
  'src/components/form-slice/FormPartUpstream/TestConnectionButton.tsx', // the key is in a variable, `limited`
  'src/components/page/ImportWsdlModal.tsx', // the key is in a variable, `limited`
  'src/components/page/RouteTestDrawer.tsx', // the key is in a variable, `named`
  'src/config/role-labels.ts', // the key is a parameter; the keys it can be are `roleLabelKeys`, checked on their own
  // Dotted strings that are not keys.
  'src/components/form-slice/FormItemPlugins/pluginTemplates.ts', // example values: `helloworld.Greeter`
  'src/components/form-slice/FormPartStreamRoute/index.tsx', // field paths: `protocol.conf`
  'src/components/form-slice/FormPartUpstream/FormSectionChecks.tsx', // field paths: `checks.active.timeout`
  'src/components/form-slice/FormPartUpstream/index.tsx', // field paths: `tls.verify`
  'src/routes/services/add.tsx', // field paths: `upstream.nodes`
  'src/types/schema/apisix/ssls.ts', // protocol names: `TLSv1.2`
];
