import { useExplorerStore } from '../../shared/store/explorerStore'
import styles from './ApiGroupSidebar.module.css'

interface APIGroupInfo {
  name: string
  displayName: string
  description?: string
  color: string
  kindCount: number
}

interface ApiGroupSidebarProps {
  groups: APIGroupInfo[]
}

export function ApiGroupSidebar({ groups }: ApiGroupSidebarProps) {
  const { 
    selectedGroup, 
    setSelectedGroup,
    showDeprecated,
    toggleShowDeprecated,
    showAlphaFeatures,
    toggleShowAlphaFeatures,
    showBetaFeatures,
    toggleShowBetaFeatures,
  } = useExplorerStore()

  return (
    <aside className={styles.sidebar}>
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>API Groups</h3>
        <div className={styles.groupList}>
          <button
            className={`${styles.groupItem} ${!selectedGroup ? styles.active : ''}`}
            onClick={() => setSelectedGroup(undefined)}
          >
            <span 
              className={styles.groupDot} 
              style={{ background: 'var(--color-starlight)' }}
            />
            <span className={styles.groupName}>All Groups</span>
            <span className={styles.groupCount}>
              {groups.reduce((acc, g) => acc + g.kindCount, 0)}
            </span>
          </button>
          
          {groups.map((group) => (
            <button
              key={group.name}
              className={`${styles.groupItem} ${selectedGroup === group.name ? styles.active : ''}`}
              onClick={() => setSelectedGroup(group.name)}
              title={group.description}
            >
              <span 
                className={styles.groupDot} 
                style={{ background: group.color }}
              />
              <span className={styles.groupName}>{group.displayName}</span>
              <span className={styles.groupCount}>{group.kindCount}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Filters</h3>
        <div className={styles.filters}>
          <label className={styles.filterItem}>
            <input
              type="checkbox"
              checked={showAlphaFeatures}
              onChange={toggleShowAlphaFeatures}
              className={styles.checkbox}
            />
            <span className={styles.filterLabel}>
              <span className={styles.alphaBadge}>α</span>
              Alpha Features
            </span>
          </label>
          
          <label className={styles.filterItem}>
            <input
              type="checkbox"
              checked={showBetaFeatures}
              onChange={toggleShowBetaFeatures}
              className={styles.checkbox}
            />
            <span className={styles.filterLabel}>
              <span className={styles.betaBadge}>β</span>
              Beta Features
            </span>
          </label>
          
          <label className={styles.filterItem}>
            <input
              type="checkbox"
              checked={showDeprecated}
              onChange={toggleShowDeprecated}
              className={styles.checkbox}
            />
            <span className={styles.filterLabel}>
              <span className={styles.deprecatedBadge}>⊘</span>
              Deprecated
            </span>
          </label>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Legend</h3>
        <div className={styles.legend}>
          <div className={styles.legendItem}>
            <span className={styles.legendLine} data-type="owns" />
            <span>Owns / Creates</span>
          </div>
          <div className={styles.legendItem}>
            <span className={styles.legendLine} data-type="selects" />
            <span>Selects</span>
          </div>
          <div className={styles.legendItem}>
            <span className={styles.legendLine} data-type="references" />
            <span>References</span>
          </div>
          <div className={styles.legendItem}>
            <span className={styles.legendLine} data-type="mounts" />
            <span>Mounts</span>
          </div>
          <div className={styles.legendItem}>
            <span className={styles.legendLine} data-type="configures" />
            <span>Configures</span>
          </div>
        </div>
      </div>

      <div className={styles.footer}>
        <p className={styles.footerText}>
          Data sourced from official Kubernetes OpenAPI specs and KEP repository
        </p>
      </div>
    </aside>
  )
}
