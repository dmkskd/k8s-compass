import { parquet } from '../../shared/hooks/useDB'

export interface PresetQuery {
  name: string
  description: string
  sql: string
  group: 'overview' | 'features' | 'feature-gates' | 'security' | 'api-changes' | 'releases' | 'content' | 'providers'
  chartType?: 'bar' | 'line' | 'pie' | 'grouped_bar' | 'stacked_bar' | 'grouped_line'
  chartStyle?: '2d' | '3d'
}

export const PRESET_QUERY_GROUPS: Record<PresetQuery['group'], { label: string; color: string }> = {
  'overview': { label: 'Overview', color: '#6366f1' },        // indigo
  'features': { label: 'Features & KEPs', color: '#10b981' }, // emerald
  'feature-gates': { label: 'Feature Gates', color: '#8b5cf6' }, // violet
  'security': { label: 'Security', color: '#f43f5e' },        // rose
  'api-changes': { label: 'API Changes', color: '#f59e0b' },  // amber
  'releases': { label: 'Releases', color: '#8b5cf6' },        // violet
  'content': { label: 'Learning Content', color: '#06b6d4' }, // cyan
  'providers': { label: 'Cloud Providers', color: '#ff9900' }, // orange (AWS color)
}

// Chart type display names
export const CHART_TYPE_LABELS: Record<string, string> = {
  'bar': 'Bar',
  'line': 'Line',
  'pie': 'Pie',
  'grouped_bar': 'Grouped Bar',
  'stacked_bar': 'Stacked Bar',
  'grouped_line': 'Grouped Line',
}

// Maximum queries to show in sidebar before showing grid
export const MAX_SIDEBAR_QUERIES = 7

// Parse metadata from SQL comments
// Format: -- @meta: title='Query Name' group='overview' description='What this query does'
//         -- @chart: type=bar labels=x values=y style=3d
function parseQueryMetadata(sql: string): PresetQuery | null {
  const metaMatch = sql.match(/--\s*@meta:\s*(.+)/i)
  if (!metaMatch) return null
  
  const metaStr = metaMatch[1]
  
  // Parse key='value' pairs
  const titleMatch = metaStr.match(/title='([^']+)'/)
  const groupMatch = metaStr.match(/group='([^']+)'/)
  const descMatch = metaStr.match(/description='([^']+)'/)
  
  if (!titleMatch || !groupMatch) return null
  
  const group = groupMatch[1].trim().toLowerCase() as PresetQuery['group']
  if (!PRESET_QUERY_GROUPS[group]) return null
  
  // Parse chart metadata if present
  const chartMatch = sql.match(/--\s*@chart:\s*(.+)/i)
  let chartType: PresetQuery['chartType'] | undefined
  let chartStyle: PresetQuery['chartStyle'] | undefined
  
  if (chartMatch) {
    const chartStr = chartMatch[1]
    const typeMatch = chartStr.match(/type=(\w+)/)
    const styleMatch = chartStr.match(/style=(\w+)/)
    
    if (typeMatch) {
      chartType = typeMatch[1] as PresetQuery['chartType']
    }
    if (styleMatch) {
      chartStyle = styleMatch[1] as PresetQuery['chartStyle']
    }
  }
  
  return {
    name: titleMatch[1].trim(),
    description: descMatch?.[1]?.trim() || '',
    group,
    sql,
    chartType,
    chartStyle,
  }
}

// Raw SQL queries with embedded metadata
// Format: -- @meta: title='...' group='...' description='...'
//         -- @chart: type=bar labels=x values=y style=3d (optional)

const RAW_QUERIES = [
  // ============ OVERVIEW ============
  `-- @meta: title='Most Complex Kinds' group='overview' description='Kinds with the highest field count'
-- @chart: type=bar labels=name values=field_count style=3d
SELECT name, group_name, field_count, scope
FROM ${parquet('kinds')}
WHERE version = (SELECT version FROM ${parquet('releases')} WHERE is_latest = true)
ORDER BY field_count DESC
LIMIT 12`,

  `-- @meta: title='Kinds by API Group' group='overview' description='Distribution of Kinds across API groups'
-- @chart: type=pie labels=group_name values=kind_count style=3d
SELECT group_name, CAST(COUNT(*) AS INTEGER) as kind_count
FROM ${parquet('kinds')}
WHERE version = (SELECT version FROM ${parquet('releases')} WHERE is_latest = true)
GROUP BY group_name
ORDER BY kind_count DESC`,

  `-- @meta: title='API Growth Over Time' group='overview' description='How the API has grown across versions'
-- @chart: type=line labels=version values=kind_count style=3d
SELECT version, CAST(COUNT(DISTINCT name) AS INTEGER) as kind_count, CAST(SUM(field_count) AS INTEGER) as total_fields
FROM ${parquet('kinds')}
GROUP BY version
ORDER BY version`,


  // ============ FEATURES & KEPs ============
  `-- @meta: title='Features by SIG' group='features' description='Count of features per SIG across all releases'
-- @chart: type=grouped_bar labels=sig group=stage values=count orientation=vertical style=3d
SELECT k.sig, f.stage, CAST(COUNT(*) AS INTEGER) as count
FROM ${parquet('features')} f
JOIN ${parquet('keps')} k ON f.kep = k.kep
GROUP BY k.sig, f.stage
ORDER BY k.sig, f.stage`,

  `-- @meta: title='Stable Features (Latest)' group='features' description='Features that reached stable status'
SELECT f.kep, k.title, k.sig, k.labels
FROM ${parquet('features')} f
JOIN ${parquet('keps')} k ON f.kep = k.kep
WHERE f.version = (SELECT version FROM ${parquet('releases')} WHERE is_latest = true) AND f.stage = 'stable'
ORDER BY k.sig, k.title`,

  `-- @meta: title='Feature Stage Distribution' group='features' description='Alpha vs Beta vs Stable features per release'
-- @chart: type=stacked_bar labels=version group=stage values=count orientation=vertical style=3d
SELECT f.version, f.stage, CAST(COUNT(*) AS INTEGER) as count
FROM ${parquet('features')} f
GROUP BY f.version, f.stage
ORDER BY f.version, f.stage`,

  `-- @meta: title='Longest Feature Journeys' group='features' description='Time spent in alpha and beta stages (stacked bar showing journey breakdown)'
-- @chart: type=stacked_bar labels=kep group=stage values=releases orientation=horizontal style=3d
WITH latest AS (SELECT MAX(version) as v FROM ${parquet('releases')}),
kep_journeys AS (
  SELECT 
    k.kep,
    k.title,
    k.history_alpha,
    k.history_beta,
    k.history_stable,
    CAST(SPLIT_PART((SELECT v FROM latest), '.', 2) AS INTEGER) as latest_minor,
    TRY_CAST(SPLIT_PART(NULLIF(k.history_alpha, ''), '.', 2) AS INTEGER) as alpha_minor,
    TRY_CAST(SPLIT_PART(NULLIF(k.history_beta, ''), '.', 2) AS INTEGER) as beta_minor,
    TRY_CAST(SPLIT_PART(NULLIF(k.history_stable, ''), '.', 2) AS INTEGER) as stable_minor
  FROM ${parquet('keps')} k
  WHERE k.history_alpha IS NOT NULL AND k.history_alpha != ''
),
with_durations AS (
  SELECT 
    kep, title, history_alpha, history_beta, history_stable,
    -- Alpha duration: from alpha start to beta start (or stable, or current)
    COALESCE(beta_minor, stable_minor, latest_minor) - alpha_minor as alpha_releases,
    -- Beta duration: from beta start to stable (or current if no stable)
    CASE 
      WHEN beta_minor IS NULL THEN 0
      ELSE COALESCE(stable_minor, latest_minor) - beta_minor
    END as beta_releases
  FROM kep_journeys
  WHERE alpha_minor IS NOT NULL
),
top_journeys AS (
  SELECT kep, title, history_alpha, history_beta, history_stable, alpha_releases, beta_releases,
         alpha_releases + beta_releases as total_journey
  FROM with_durations
  WHERE alpha_releases + beta_releases >= 3
  ORDER BY total_journey DESC
  LIMIT 15
),
with_rank AS (
  SELECT *, ROW_NUMBER() OVER (ORDER BY total_journey DESC) as rank
  FROM top_journeys
)
SELECT kep, 'alpha' as stage, alpha_releases as releases, rank FROM with_rank WHERE alpha_releases > 0
UNION ALL
SELECT kep, 'beta' as stage, beta_releases as releases, rank FROM with_rank WHERE beta_releases > 0
ORDER BY rank, stage DESC`,

  `-- @meta: title='Longest Running Non-Stable' group='features' description='Features in alpha/beta for 5+ releases, still not stable'
WITH latest AS (SELECT MAX(version) as v FROM ${parquet('releases')}),
valid_features AS (
  SELECT f.kep, k.title, k.sig, k.history_alpha, k.history_beta, f.stage,
         COALESCE(NULLIF(k.history_alpha, ''), NULLIF(k.history_beta, '')) as started_version
  FROM ${parquet('features')} f
  JOIN ${parquet('keps')} k ON f.kep = k.kep
  WHERE f.version = (SELECT v FROM latest)
    AND f.stage IN ('alpha', 'beta')
    AND (k.history_stable IS NULL OR k.history_stable = '')
    AND COALESCE(NULLIF(k.history_alpha, ''), NULLIF(k.history_beta, '')) IS NOT NULL
)
SELECT kep, title, sig, history_alpha, history_beta, stage as current_stage,
       CAST(SPLIT_PART((SELECT v FROM latest), '.', 2) AS INTEGER) - 
       CAST(SPLIT_PART(started_version, '.', 2) AS INTEGER) as releases_waiting
FROM valid_features
WHERE CAST(SPLIT_PART((SELECT v FROM latest), '.', 2) AS INTEGER) - 
      CAST(SPLIT_PART(started_version, '.', 2) AS INTEGER) >= 5
ORDER BY releases_waiting DESC`,

  `-- @meta: title='Features with Feature Gates' group='features' description='Features that require explicit feature gate enablement'
SELECT f.kep, k.title, k.feature_gate, f.stage, k.sig
FROM ${parquet('features')} f
JOIN ${parquet('keps')} k ON f.kep = k.kep
WHERE k.feature_gate IS NOT NULL AND f.version = (SELECT version FROM ${parquet('releases')} WHERE is_latest = true)
ORDER BY f.stage DESC, k.sig`,

  `-- @meta: title='All KEPs' group='features' description='Browse all Kubernetes Enhancement Proposals'
SELECT kep, title, sig, labels, feature_gate, history_alpha, history_beta, history_stable
FROM ${parquet('keps')}
ORDER BY kep`,

  `-- @meta: title='KEPs by Label' group='features' description='Count of KEPs per topic label'
-- @chart: type=bar labels=label values=count style=3d
SELECT label, CAST(COUNT(*) AS INTEGER) as count
FROM ${parquet('keps')}, UNNEST(labels) as t(label)
WHERE labels IS NOT NULL AND len(labels) > 0
GROUP BY label
ORDER BY count DESC
LIMIT 20`,

  // ============ FEATURE GATES ============
  `-- @meta: title='Feature Gates by Stage' group='feature-gates' description='Distribution of feature gates by stage in latest version'
-- @chart: type=pie labels=stage values=count style=3d
SELECT stage, CAST(COUNT(*) AS INTEGER) as count
FROM ${parquet('feature_gates')}
WHERE version = (SELECT version FROM ${parquet('releases')} WHERE is_latest = true)
GROUP BY stage
ORDER BY 
  CASE stage 
    WHEN 'stable' THEN 1 
    WHEN 'beta' THEN 2 
    WHEN 'alpha' THEN 3 
    WHEN 'deprecated' THEN 4 
  END`,

  `-- @meta: title='All Feature Gates (Latest)' group='feature-gates' description='Browse all feature gates in the latest version'
SELECT name, stage, default_value, lock_to_default, description, kep, kep_title
FROM ${parquet('feature_gates')}
WHERE version = (SELECT version FROM ${parquet('releases')} WHERE is_latest = true)
ORDER BY stage, name`,

  `-- @meta: title='Feature Gates with KEPs' group='feature-gates' description='Feature gates linked to KEPs'
SELECT fg.name, fg.stage, fg.default_value, fg.kep, fg.kep_title
FROM ${parquet('feature_gates')} fg
WHERE fg.version = (SELECT version FROM ${parquet('releases')} WHERE is_latest = true) AND fg.kep IS NOT NULL
ORDER BY fg.stage, fg.name`,

  `-- @meta: title='Locked Feature Gates' group='feature-gates' description='Feature gates that cannot be changed (locked to default)'
SELECT name, stage, default_value, kep, kep_title
FROM ${parquet('feature_gates')}
WHERE version = (SELECT version FROM ${parquet('releases')} WHERE is_latest = true) AND lock_to_default = true
ORDER BY stage, name`,

  `-- @meta: title='Feature Gate Evolution' group='feature-gates' description='How feature gate counts have changed across versions'
-- @chart: type=stacked_bar labels=version group=stage values=count orientation=vertical style=3d
SELECT version, stage, CAST(COUNT(*) AS INTEGER) as count
FROM ${parquet('feature_gates')}
GROUP BY version, stage
ORDER BY version, 
  CASE stage 
    WHEN 'stable' THEN 1 
    WHEN 'beta' THEN 2 
    WHEN 'alpha' THEN 3 
    WHEN 'deprecated' THEN 4 
  END`,

  `-- @meta: title='New Alpha Feature Gates' group='feature-gates' description='Alpha feature gates in the latest version'
SELECT name, default_value, description, kep, kep_title
FROM ${parquet('feature_gates')}
WHERE version = (SELECT version FROM ${parquet('releases')} WHERE is_latest = true) AND stage = 'alpha'
ORDER BY name`,

  `-- @meta: title='Beta Feature Gates' group='feature-gates' description='Beta feature gates ready for wider testing'
SELECT name, default_value, description, kep, kep_title
FROM ${parquet('feature_gates')}
WHERE version = (SELECT version FROM ${parquet('releases')} WHERE is_latest = true) AND stage = 'beta'
ORDER BY name`,

  // ============ SECURITY ============
  `-- @meta: title='All Security CVEs' group='security' description='Security vulnerabilities across all releases'
SELECT cve, title, version, patch_version, affected_components
FROM ${parquet('security_cves')}
ORDER BY version DESC, cve`,

  `-- @meta: title='CVEs by Release' group='security' description='Count of CVEs per release version'
-- @chart: type=bar labels=version values=cve_count style=3d
SELECT version, CAST(COUNT(*) AS INTEGER) as cve_count
FROM ${parquet('security_cves')}
GROUP BY version
ORDER BY version`,

  `-- @meta: title='Action Required Notes' group='security' description='Notes requiring user action before upgrade'
SELECT version, description, sigs, pr_number
FROM ${parquet('action_required')}
ORDER BY version DESC`,

  // ============ API CHANGES ============
  `-- @meta: title='New Fields (Latest)' group='api-changes' description='Fields added in the latest version'
SELECT kind, group_name, field_path
FROM ${parquet('api_diffs')}
WHERE to_version = (SELECT version FROM ${parquet('releases')} WHERE is_latest = true) AND change_type = 'field_added'
ORDER BY kind, field_path`,

  `-- @meta: title='Kinds Introduced After 1.30' group='api-changes' description='New Kinds added in recent versions'
SELECT name, group_name, MIN(version) as introduced_in
FROM ${parquet('kinds')}
GROUP BY name, group_name
HAVING MIN(version) > '1.30'
ORDER BY introduced_in DESC, name`,

  `-- @meta: title='Removed Fields' group='api-changes' description='Fields removed across versions'
SELECT from_version, to_version, kind, field_path
FROM ${parquet('api_diffs')}
WHERE change_type = 'field_removed'
ORDER BY to_version DESC, kind`,

  `-- @meta: title='API Changes by Version' group='api-changes' description='Count of changes per version transition'
-- @chart: type=bar labels=to_version values=change_count style=3d
SELECT to_version, CAST(COUNT(*) AS INTEGER) as change_count
FROM ${parquet('api_diffs')}
GROUP BY to_version
ORDER BY to_version`,

  // ============ RELEASES ============
  `-- @meta: title='All Releases' group='releases' description='Overview of all Kubernetes releases'
SELECT version, codename, release_date, total_features, stable_features, beta_features, alpha_features
FROM ${parquet('releases')}
ORDER BY version DESC`,

  `-- @meta: title='Deprecations' group='releases' description='Deprecated items across releases'
SELECT version, item, reason, replacement, removal_target
FROM ${parquet('deprecations')}
ORDER BY version DESC`,

  `-- @meta: title='Patch Releases' group='releases' description='Patch releases and their security fixes'
SELECT version, patch_version, security_fixes_count, changes_count
FROM ${parquet('patch_releases')}
ORDER BY version DESC, patch_version DESC`,

  `-- @meta: title='Release Changes by Kind' group='releases' description='Types of changes in each release'
-- @chart: type=grouped_bar labels=version group=kind values=count orientation=vertical style=3d
SELECT version, kind, CAST(COUNT(*) AS INTEGER) as count
FROM ${parquet('release_changes')}
GROUP BY version, kind
ORDER BY version, kind`,

  // ============ LEARNING CONTENT ============
  `-- @meta: title='All Learning Content' group='content' description='Browse all curated learning resources'
SELECT DISTINCT url, title, content_type, source, is_official, published_date, summary
FROM ${parquet('content_links')}
ORDER BY is_official DESC, published_date DESC NULLS LAST`,

  `-- @meta: title='Content by Type' group='content' description='Distribution of content types'
-- @chart: type=pie labels=content_type values=count style=3d
SELECT content_type, CAST(COUNT(DISTINCT url) AS INTEGER) as count
FROM ${parquet('content_links')}
GROUP BY content_type
ORDER BY count DESC`,

  `-- @meta: title='Content by Source' group='content' description='Top content sources'
-- @chart: type=bar labels=source values=count style=3d
SELECT source, CAST(COUNT(DISTINCT url) AS INTEGER) as count
FROM ${parquet('content_links')}
GROUP BY source
ORDER BY count DESC
LIMIT 15`,

  `-- @meta: title='Official vs Community Content' group='content' description='Breakdown of official K8s content vs community'
-- @chart: type=pie labels=source_type values=count style=3d
SELECT CASE WHEN is_official THEN 'Official' ELSE 'Community' END as source_type, 
       CAST(COUNT(DISTINCT url) AS INTEGER) as count
FROM ${parquet('content_links')}
GROUP BY is_official`,

  `-- @meta: title='Content by Topic Label' group='content' description='Most common topic labels in content'
-- @chart: type=bar labels=label values=count style=3d
SELECT label, CAST(COUNT(DISTINCT url) AS INTEGER) as count
FROM ${parquet('content_links')}, UNNEST(labels) as t(label)
WHERE labels IS NOT NULL AND len(labels) > 0
GROUP BY label
ORDER BY count DESC
LIMIT 20`,

  `-- @meta: title='Content Linked to KEPs' group='content' description='Content that references specific KEPs'
SELECT DISTINCT c.url, c.title, c.content_type, c.target_id as kep
FROM ${parquet('content_links')} c
WHERE c.target_type = 'kep'
ORDER BY c.target_id`,

  // ============ CLOUD PROVIDERS ============
  `-- @meta: title='All Providers' group='providers' description='Cloud provider metadata'
SELECT provider_id, display_name, versioning_scheme, support_model, 
       standard_support_months, extended_support_months, version_docs_url
FROM ${parquet('providers')}
ORDER BY display_name`,

  `-- @meta: title='Provider Version Support' group='providers' description='All K8s versions supported by each provider'
SELECT p.display_name as provider, pv.k8s_version, pv.provider_version, 
       pv.status, pv.provider_release_date, pv.eol_standard_date, pv.total_support_days
FROM ${parquet('provider_versions')} pv
JOIN ${parquet('providers')} p ON pv.provider_id = p.provider_id
ORDER BY p.display_name, pv.k8s_version DESC`,

  `-- @meta: title='Currently Supported Versions' group='providers' description='Versions currently in support by provider'
-- @chart: type=grouped_bar labels=provider group=k8s_version values=count orientation=vertical style=3d
SELECT p.display_name as provider, pv.k8s_version, 1 as count
FROM ${parquet('provider_versions')} pv
JOIN ${parquet('providers')} p ON pv.provider_id = p.provider_id
WHERE pv.status = 'supported'
ORDER BY p.display_name, pv.k8s_version DESC`,

  `-- @meta: title='Longest Support Period' group='providers' description='Which provider offers the longest total support?'
-- @chart: type=bar labels=provider values=avg_support_days style=3d
SELECT p.display_name as provider, 
       CAST(AVG(pv.total_support_days) AS INTEGER) as avg_support_days,
       CAST(MAX(pv.total_support_days) AS INTEGER) as max_support_days,
       CAST(MIN(pv.total_support_days) AS INTEGER) as min_support_days
FROM ${parquet('provider_versions')} pv
JOIN ${parquet('providers')} p ON pv.provider_id = p.provider_id
WHERE pv.total_support_days IS NOT NULL
GROUP BY p.display_name
ORDER BY avg_support_days DESC`,

  `-- @meta: title='Time to Availability' group='providers' description='Days from upstream K8s release to provider availability (K8s 1.30+, lower is better)'
-- @chart: type=grouped_bar labels=provider group=metric values=days orientation=vertical style=3d
WITH stats AS (
  SELECT p.display_name as provider,
         CAST(AVG(pv.days_to_availability) AS INTEGER) as avg_days,
         CAST(MIN(pv.days_to_availability) AS INTEGER) as min_days,
         CAST(MAX(pv.days_to_availability) AS INTEGER) as max_days
  FROM ${parquet('provider_versions')} pv
  JOIN ${parquet('providers')} p ON pv.provider_id = p.provider_id
  WHERE pv.days_to_availability IS NOT NULL AND pv.days_to_availability > 0
    AND pv.k8s_version >= '1.30'
  GROUP BY p.display_name
)
SELECT * FROM (
  SELECT provider, 'Slowest' as metric, max_days as days, 1 as sort_order FROM stats
  UNION ALL
  SELECT provider, 'Average' as metric, avg_days as days, 2 as sort_order FROM stats
  UNION ALL
  SELECT provider, 'Fastest' as metric, min_days as days, 3 as sort_order FROM stats
) sub
ORDER BY provider, sort_order`,

  `-- @meta: title='Release Timeline by Provider' group='providers' description='Days to availability per K8s version for each provider (K8s 1.20+)'
-- @chart: type=grouped_line labels=k8s_version group=provider values=days style=3d
SELECT pv.k8s_version, p.display_name as provider, 
       CAST(pv.days_to_availability AS INTEGER) as days
FROM ${parquet('provider_versions')} pv
JOIN ${parquet('providers')} p ON pv.provider_id = p.provider_id
WHERE pv.days_to_availability IS NOT NULL AND pv.days_to_availability > 0
  AND pv.k8s_version >= '1.20'
ORDER BY pv.k8s_version, p.display_name`,

  `-- @meta: title='Supported Version Count' group='providers' description='How many versions does each provider currently support?'
-- @chart: type=bar labels=provider values=supported_count style=3d
SELECT p.display_name as provider, 
       CAST(COUNT(*) AS INTEGER) as supported_count
FROM ${parquet('provider_versions')} pv
JOIN ${parquet('providers')} p ON pv.provider_id = p.provider_id
WHERE pv.status = 'supported'
GROUP BY p.display_name
ORDER BY supported_count DESC`,

  `-- @meta: title='Extended Support Availability' group='providers' description='Which providers offer extended support?'
SELECT p.display_name as provider, pv.k8s_version,
       pv.eol_standard_date as standard_eol,
       pv.eol_extended_date as extended_eol,
       pv.extended_support_days
FROM ${parquet('provider_versions')} pv
JOIN ${parquet('providers')} p ON pv.provider_id = p.provider_id
WHERE pv.extended_support_days > 0
ORDER BY p.display_name, pv.k8s_version DESC`,

  `-- @meta: title='Version Availability Timeline' group='providers' description='When did each provider release K8s 1.30+?'
SELECT pv.k8s_version, p.display_name as provider,
       pv.upstream_release_date, pv.provider_release_date, pv.days_to_availability
FROM ${parquet('provider_versions')} pv
JOIN ${parquet('providers')} p ON pv.provider_id = p.provider_id
WHERE pv.k8s_version >= '1.30'
ORDER BY pv.k8s_version DESC, pv.days_to_availability`,

  `-- @meta: title='EOL Versions' group='providers' description='Versions that have reached end of life'
SELECT p.display_name as provider, pv.k8s_version, pv.provider_version,
       pv.eol_standard_date, pv.eol_extended_date
FROM ${parquet('provider_versions')} pv
JOIN ${parquet('providers')} p ON pv.provider_id = p.provider_id
WHERE pv.status = 'eol'
ORDER BY p.display_name, pv.k8s_version DESC`,

  `-- @meta: title='Extended Support Versions' group='providers' description='Versions with extended support available'
SELECT p.display_name as provider, pv.k8s_version, pv.provider_version,
       pv.provider_release_date, pv.eol_standard_date, pv.eol_extended_date,
       pv.total_support_days, pv.status
FROM ${parquet('provider_versions')} pv
JOIN ${parquet('providers')} p ON pv.provider_id = p.provider_id
WHERE pv.has_extended_support = true
ORDER BY p.display_name, pv.k8s_version DESC`,

  `-- @meta: title='Projected Availability' group='providers' description='When will the latest K8s version be available? (based on last 5 versions avg)'
WITH latest_k8s AS (
  SELECT version, release_date 
  FROM 'releases.parquet' 
  WHERE is_latest = true
),
provider_history AS (
  -- Get last 5 versions per provider with valid days_to_availability
  SELECT pv.provider_id, pv.k8s_version, pv.days_to_availability,
         ROW_NUMBER() OVER (PARTITION BY pv.provider_id ORDER BY pv.k8s_version DESC) as rn
  FROM 'provider_versions.parquet' pv
  WHERE pv.days_to_availability IS NOT NULL AND pv.days_to_availability > 0
),
provider_avg AS (
  SELECT provider_id, 
         CAST(AVG(days_to_availability) AS INTEGER) as avg_days,
         CAST(MIN(days_to_availability) AS INTEGER) as min_days,
         CAST(MAX(days_to_availability) AS INTEGER) as max_days,
         COUNT(*) as sample_count
  FROM provider_history
  WHERE rn <= 5
  GROUP BY provider_id
),
already_available AS (
  SELECT pv.provider_id, pv.provider_release_date
  FROM 'provider_versions.parquet' pv
  CROSS JOIN latest_k8s lk
  WHERE pv.k8s_version = lk.version
)
SELECT 
  p.display_name as provider,
  lk.version as k8s_version,
  lk.release_date as upstream_release,
  CASE 
    WHEN aa.provider_release_date IS NOT NULL THEN 'Available'
    ELSE 'Projected'
  END as status,
  COALESCE(aa.provider_release_date, 
    CAST(CAST(lk.release_date AS DATE) + INTERVAL (pa.avg_days) DAY AS VARCHAR)
  ) as availability_date,
  CASE 
    WHEN aa.provider_release_date IS NOT NULL THEN 0
    ELSE pa.avg_days
  END as days_from_upstream,
  pa.min_days || '-' || pa.max_days || ' days (n=' || pa.sample_count || ')' as historical_range
FROM 'providers.parquet' p
CROSS JOIN latest_k8s lk
LEFT JOIN provider_avg pa ON p.provider_id = pa.provider_id
LEFT JOIN already_available aa ON p.provider_id = aa.provider_id
ORDER BY days_from_upstream DESC, p.display_name`
]

// Parse all queries and filter out any that fail to parse
export const PRESET_QUERIES: PresetQuery[] = RAW_QUERIES
  .map(parseQueryMetadata)
  .filter((q): q is PresetQuery => q !== null)
