/**
 * Release Data hooks using DuckDB WASM + Parquet
 */
import { useState, useEffect, useMemo } from 'react'
import { useQuery, parquet, executeQuery } from './useDB'
import type { ReleaseNotes, ReleaseFeature } from '../types'
import type {
  ReleasesRow,
  DeprecationsRow,
  ReleaseChangesRow,
  ActionRequiredRow,
  SecurityCvesRow,
  PatchReleasesRow,
  PatchReleaseChangesRow,
  PatchSecurityFixesRow,
} from '../types/db-types'

// Extended feature row that joins features with keps (includes SQL aliases)
interface FeatureWithKepRow {
  version?: string
  kep?: string
  kep_path?: string
  title?: string
  stage?: string
  is_highlight?: boolean
  sig?: string
  category?: string  // SQL alias
  labels?: string[]
  description?: string
  impact?: string
  feature_gate?: string
  affected_kinds?: string[]
  affected_fields?: string[]
  history_alpha?: string
  history_beta?: string
  history_stable?: string
  history_tentative?: string[]  // SQL alias
  history_verified?: string[]   // SQL alias
}

// Get release index (list of all releases)
export function useReleaseIndexDB() {
  const sql = `
    SELECT version, codename, release_date, total_features
    FROM ${parquet('releases')}
    ORDER BY version DESC
  `
  const { data, loading, error } = useQuery<ReleasesRow>(sql)
  
  const index = useMemo(() => {
    if (!data || data.length === 0) return null
    return {
      releases: data.map(r => ({
        version: r.version!,
        codename: r.codename ?? undefined,
        file: `${r.version}.json`, // For compatibility
        releaseDate: r.release_date!,
      })),
      latestVersion: data[0].version!, // First one is latest (ORDER BY DESC)
    }
  }, [data])

  return { index, loading, error }
}

// Get full release notes for a version
export function useReleaseNotesDB(version: string | undefined) {
  const [release, setRelease] = useState<ReleaseNotes | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!version) {
      setRelease(null)
      return
    }

    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        const [releases, features, deprecations, changes, urgentNotes, securityCves, patchReleases, patchChanges, patchSecurityFixes] = await Promise.all([
          executeQuery<ReleasesRow>(`
            SELECT version, codename, description, release_date, total_features,
                   stable_features, beta_features, alpha_features, themes
            FROM ${parquet('releases')}
            WHERE version = '${version}'
          `),
          executeQuery<FeatureWithKepRow>(`
            SELECT f.kep, k.kep_path, k.title, f.stage, f.is_highlight, k.sig, '' as category, k.labels, k.description,
                   k.impact, k.feature_gate, k.affected_kinds, k.affected_fields,
                   k.history_alpha, k.history_beta, k.history_stable,
                   ARRAY[]::VARCHAR[] as history_tentative, ARRAY[]::VARCHAR[] as history_verified
            FROM ${parquet('features')} f
            JOIN ${parquet('keps')} k ON f.kep = k.kep
            WHERE f.version = '${version}'
          `),
          executeQuery<DeprecationsRow>(`
            SELECT item, reason, replacement, removal_target
            FROM ${parquet('deprecations')}
            WHERE version = '${version}'
          `).catch(err => {
            console.error('[useReleaseNotes] Failed to load deprecations:', err)
            return [] as DeprecationsRow[]
          }),
          executeQuery<ReleaseChangesRow>(`
            SELECT kind, description, pr_number, pr_url, author, sigs, kep_links,
                   enrichment_problem, enrichment_affected, enrichment_fix,
                   enrichment_impact, enrichment_category, enrichment_severity,
                   enrichment_components, enrichment_labels
            FROM ${parquet('release_changes')}
            WHERE version = '${version}'
          `).catch(() => [] as ReleaseChangesRow[]),
          executeQuery<ActionRequiredRow>(`
            SELECT description, pr_number, pr_url, author, sigs
            FROM ${parquet('action_required')}
            WHERE version = '${version}'
          `).catch(() => [] as ActionRequiredRow[]),
          executeQuery<SecurityCvesRow>(`
            SELECT cve, title, description, affected_versions, fixed_versions, 
                   affected_components, patch_version
            FROM ${parquet('security_cves')}
            WHERE version = '${version}'
          `).catch(() => [] as SecurityCvesRow[]),
          executeQuery<PatchReleasesRow>(`
            SELECT patch_version, changelog_since, security_fixes_count, changes_count
            FROM ${parquet('patch_releases')}
            WHERE version = '${version}'
          `).catch(() => [] as PatchReleasesRow[]),
          executeQuery<PatchReleaseChangesRow>(`
            SELECT patch_version, kind, description, pr_number, pr_url, author, sigs,
                   enrichment_problem, enrichment_affected, enrichment_fix,
                   enrichment_impact, enrichment_category, enrichment_severity,
                   enrichment_components, enrichment_labels
            FROM ${parquet('patch_release_changes')}
            WHERE version = '${version}'
          `).catch(() => [] as PatchReleaseChangesRow[]),
          executeQuery<PatchSecurityFixesRow>(`
            SELECT patch_version, cve, title, description
            FROM ${parquet('patch_security_fixes')}
            WHERE version = '${version}'
          `).catch(() => [] as PatchSecurityFixesRow[]),
        ])

        if (releases.length === 0) {
          throw new Error(`Release ${version} not found`)
        }

        const r = releases[0]
        
        // Group changes by kind
        const changesByKind: Record<string, Array<{
          description: string
          prNumber?: number
          prUrl?: string
          author?: string
          sigs?: string[]
          kepLinks?: string[]
          enrichment?: {
            problem: string
            affected: string
            fix: string
            impact: string
            category: string
            severity: string
            affectedComponents: string[]
            labels: string[]
          }
        }>> = {}
        
        for (const change of changes) {
          const kind = change.kind!
          if (!changesByKind[kind]) {
            changesByKind[kind] = []
          }
          changesByKind[kind].push({
            description: change.description!,
            prNumber: change.pr_number ?? undefined,
            prUrl: change.pr_url ?? undefined,
            author: change.author ?? undefined,
            sigs: change.sigs ?? undefined,
            kepLinks: change.kep_links ?? undefined,
            enrichment: change.enrichment_problem ? {
              problem: change.enrichment_problem,
              affected: change.enrichment_affected ?? '',
              fix: change.enrichment_fix ?? '',
              impact: change.enrichment_impact ?? '',
              category: change.enrichment_category ?? '',
              severity: change.enrichment_severity ?? '',
              affectedComponents: change.enrichment_components ?? [],
              labels: change.enrichment_labels ?? [],
            } : undefined,
          })
        }
        
        setRelease({
          version: r.version!,
          codename: r.codename ?? undefined,
          description: r.description ?? undefined,
          releaseDate: r.release_date!,
          summary: {
            total: r.total_features!,
            stable: r.stable_features!,
            beta: r.beta_features!,
            alpha: r.alpha_features!,
          },
          themes: r.themes ?? [],
          features: features.map(f => ({
            kep: f.kep!,
            kepPath: f.kep_path ?? undefined,
            title: f.title!,
            stage: f.stage as ReleaseFeature['stage'],
            sig: f.sig!,
            category: f.category ?? '',
            labels: f.labels ?? [],
            description: f.description!,
            impact: f.impact ?? undefined,
            featureGate: f.feature_gate ?? undefined,
            isHighlight: f.is_highlight ?? undefined,
            affectedKinds: f.affected_kinds ?? [],
            affectedFields: f.affected_fields ?? [],
            history: {
              alpha: f.history_alpha ?? undefined,
              beta: f.history_beta ?? undefined,
              stable: f.history_stable ?? undefined,
              tentative: f.history_tentative ?? undefined,
              verified: f.history_verified ?? undefined,
            },
          })),
          deprecations: deprecations.map(d => ({
            item: d.item!,
            reason: d.reason!,
            replacement: d.replacement ?? undefined,
            removalTarget: d.removal_target ?? undefined,
          })),
          changesByKind: Object.keys(changesByKind).length > 0 ? changesByKind : undefined,
          actionRequired: urgentNotes.length > 0 ? urgentNotes.map(n => ({
            description: n.description!,
            prNumber: n.pr_number ?? undefined,
            prUrl: n.pr_url ?? undefined,
            author: n.author ?? undefined,
            sigs: n.sigs ?? undefined,
          })) : undefined,
          securityInformation: securityCves.length > 0 ? securityCves.map(c => ({
            cve: c.cve!,
            title: c.title!,
            description: c.description!,
            affectedVersions: c.affected_versions ?? undefined,
            fixedVersions: c.fixed_versions ?? undefined,
            affectedComponents: c.affected_components ?? undefined,
            patchVersion: c.patch_version ?? undefined,
          })) : undefined,
          patchReleases: patchReleases.length > 0 ? patchReleases.map(p => {
            // Group patch changes by kind
            const patchChangesByKind: Record<string, Array<{
              description: string
              prNumber?: number
              prUrl?: string
              author?: string
              sigs?: string[]
              enrichment?: {
                problem: string
                affected: string
                fix: string
                impact: string
                category: string
                severity: string
                affectedComponents: string[]
                labels: string[]
              }
            }>> = {}
            
            for (const change of patchChanges.filter(c => c.patch_version === p.patch_version)) {
              const kind = change.kind!
              if (!patchChangesByKind[kind]) {
                patchChangesByKind[kind] = []
              }
              patchChangesByKind[kind].push({
                description: change.description!,
                prNumber: change.pr_number ?? undefined,
                prUrl: change.pr_url ?? undefined,
                author: change.author ?? undefined,
                sigs: change.sigs ?? undefined,
                enrichment: change.enrichment_problem ? {
                  problem: change.enrichment_problem,
                  affected: change.enrichment_affected ?? '',
                  fix: change.enrichment_fix ?? '',
                  impact: change.enrichment_impact ?? '',
                  category: change.enrichment_category ?? '',
                  severity: change.enrichment_severity ?? '',
                  affectedComponents: change.enrichment_components ?? [],
                  labels: change.enrichment_labels ?? [],
                } : undefined,
              })
            }
            
            // Get security fixes for this patch
            const securityFixes = patchSecurityFixes
              .filter(s => s.patch_version === p.patch_version)
              .map(s => ({
                cve: s.cve!,
                title: s.title!,
                description: s.description!,
              }))
            
            return {
              version: p.patch_version!,
              changelogSince: p.changelog_since ?? undefined,
              changesByKind: Object.keys(patchChangesByKind).length > 0 ? patchChangesByKind : undefined,
              securityFixes: securityFixes.length > 0 ? securityFixes : undefined,
            }
          }) : undefined,
          references: [],
        })
        setLoading(false)
      } catch (err) {
        setError(err as Error)
        setLoading(false)
      }
    })()
  }, [version])

  return { release, loading, error }
}

// Get all releases with full data
export function useAllReleasesDB() {
  const [releases, setReleases] = useState<ReleaseNotes[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const [releaseRows, featureRows, deprecationRows] = await Promise.all([
          executeQuery<ReleasesRow>(`
            SELECT version, codename, release_date, total_features,
                   stable_features, beta_features, alpha_features, themes
            FROM ${parquet('releases')}
            ORDER BY version DESC
          `),
          executeQuery<FeatureWithKepRow>(`
            SELECT f.version, f.kep, k.kep_path, k.title, f.stage, f.is_highlight, k.sig, '' as category,
                   k.description, k.impact, k.feature_gate, k.affected_kinds,
                   k.affected_fields, k.history_alpha, k.history_beta, k.history_stable,
                   ARRAY[]::VARCHAR[] as history_tentative, ARRAY[]::VARCHAR[] as history_verified
            FROM ${parquet('features')} f
            JOIN ${parquet('keps')} k ON f.kep = k.kep
          `),
          executeQuery<DeprecationsRow>(`
            SELECT version, item, reason, replacement, removal_target
            FROM ${parquet('deprecations')}
          `),
        ])

        // Group features and deprecations by version
        const featuresByVersion = new Map<string, FeatureWithKepRow[]>()
        for (const f of featureRows) {
          if (!featuresByVersion.has(f.version!)) {
            featuresByVersion.set(f.version!, [])
          }
          featuresByVersion.get(f.version!)!.push(f)
        }

        const deprecationsByVersion = new Map<string, DeprecationsRow[]>()
        for (const d of deprecationRows) {
          if (!deprecationsByVersion.has(d.version!)) {
            deprecationsByVersion.set(d.version!, [])
          }
          deprecationsByVersion.get(d.version!)!.push(d)
        }

        const result = releaseRows.map(r => ({
          version: r.version!,
          codename: r.codename ?? undefined,
          releaseDate: r.release_date!,
          summary: {
            total: r.total_features!,
            stable: r.stable_features!,
            beta: r.beta_features!,
            alpha: r.alpha_features!,
          },
          themes: r.themes ?? [],
          features: (featuresByVersion.get(r.version!) ?? []).map(f => ({
            kep: f.kep!,
            kepPath: f.kep_path ?? undefined,
            title: f.title!,
            stage: f.stage as ReleaseFeature['stage'],
            sig: f.sig!,
            category: '',
            description: f.description!,
            impact: f.impact ?? undefined,
            featureGate: f.feature_gate ?? undefined,
            isHighlight: f.is_highlight ?? undefined,
            affectedKinds: f.affected_kinds ?? [],
            affectedFields: f.affected_fields ?? [],
            history: {
              alpha: f.history_alpha ?? undefined,
              beta: f.history_beta ?? undefined,
              stable: f.history_stable ?? undefined,
            },
          })),
          deprecations: (deprecationsByVersion.get(r.version!) ?? []).map(d => ({
            item: d.item!,
            reason: d.reason!,
            replacement: d.replacement ?? undefined,
            removalTarget: d.removal_target ?? undefined,
          })),
          references: [],
        }))

        setReleases(result)
        setLoading(false)
      } catch (err) {
        setError(err as Error)
        setLoading(false)
      }
    })()
  }, [])

  return { releases, loading, error }
}
