import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { executeQuery, parquet, TABLES, useSchemaMetadata, fetchSchemaMetadata, type SchemaMetadata, type TableRelationship } from '../../shared/hooks/useDB'
import { PRESET_QUERIES, PRESET_QUERY_GROUPS, MAX_SIDEBAR_QUERIES, CHART_TYPE_LABELS, PresetQuery } from './presetQueries'
import { BarChart3D, PieChart3D, LineChart3D, GroupedBarChart3D, StackedBarChart3D, GroupedLineChart3D } from './Chart3D'
import { useExplorerStore } from '../../shared/store/explorerStore'
import styles from './AnalyticsView.module.css'

// Basic SQL syntax highlighting
const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'LIKE', 'BETWEEN',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'ON', 'USING',
  'GROUP', 'BY', 'HAVING', 'ORDER', 'ASC', 'DESC', 'LIMIT', 'OFFSET',
  'AS', 'DISTINCT', 'ALL', 'UNION', 'INTERSECT', 'EXCEPT',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'TABLE',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'CAST', 'COALESCE', 'NULLIF',
  'TRUE', 'FALSE', 'WITH', 'RECURSIVE', 'OVER', 'PARTITION', 'ROWS', 'RANGE',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'ARRAY_AGG', 'STRING_AGG',
]

const SQL_FUNCTIONS = [
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'ROUND', 'FLOOR', 'CEIL', 'ABS',
  'LENGTH', 'LOWER', 'UPPER', 'TRIM', 'SUBSTRING', 'REPLACE', 'CONCAT',
  'COALESCE', 'NULLIF', 'CAST', 'EXTRACT', 'DATE_TRUNC',
  'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE',
  'ARRAY_AGG', 'STRING_AGG', 'LIST', 'UNNEST',
]

// Inline styles for syntax highlighting (CSS modules scope classes)
const sqlStyles = {
  keyword: 'color: var(--sql-keyword); font-weight: 500',
  function: 'color: var(--sql-function)',
  string: 'color: var(--sql-string)',
  number: 'color: var(--sql-number)',
  comment: 'color: var(--sql-comment); font-style: italic',
  operator: 'color: var(--sql-operator)',
}

function highlightSQL(sql: string): string {
  // Escape HTML first
  let result = sql
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  
  // Tokenize to avoid highlighting inside strings/comments
  const tokens: { type: string; value: string }[] = []
  let remaining = result
  
  while (remaining.length > 0) {
    // Single-line comment
    const commentMatch = remaining.match(/^(--[^\n]*)/)
    if (commentMatch) {
      tokens.push({ type: 'comment', value: commentMatch[1] })
      remaining = remaining.slice(commentMatch[1].length)
      continue
    }
    
    // Multi-line comment
    const multiCommentMatch = remaining.match(/^(\/\*[\s\S]*?\*\/)/)
    if (multiCommentMatch) {
      tokens.push({ type: 'comment', value: multiCommentMatch[1] })
      remaining = remaining.slice(multiCommentMatch[1].length)
      continue
    }
    
    // String
    const stringMatch = remaining.match(/^('(?:[^'\\]|\\.)*')/)
    if (stringMatch) {
      tokens.push({ type: 'string', value: stringMatch[1] })
      remaining = remaining.slice(stringMatch[1].length)
      continue
    }
    
    // Number
    const numberMatch = remaining.match(/^(\d+\.?\d*)/)
    if (numberMatch) {
      tokens.push({ type: 'number', value: numberMatch[1] })
      remaining = remaining.slice(numberMatch[1].length)
      continue
    }
    
    // Word (potential keyword/function)
    const wordMatch = remaining.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/)
    if (wordMatch) {
      const word = wordMatch[1]
      const upperWord = word.toUpperCase()
      if (SQL_KEYWORDS.includes(upperWord)) {
        tokens.push({ type: 'keyword', value: word })
      } else if (SQL_FUNCTIONS.includes(upperWord)) {
        tokens.push({ type: 'function', value: word })
      } else {
        tokens.push({ type: 'text', value: word })
      }
      remaining = remaining.slice(word.length)
      continue
    }
    
    // Operators
    const opMatch = remaining.match(/^(&lt;=|&gt;=|&lt;&gt;|!=|&lt;|&gt;|=)/)
    if (opMatch) {
      tokens.push({ type: 'operator', value: opMatch[1] })
      remaining = remaining.slice(opMatch[1].length)
      continue
    }
    
    // Any other character
    tokens.push({ type: 'text', value: remaining[0] })
    remaining = remaining.slice(1)
  }
  
  // Build highlighted HTML
  return tokens.map(t => {
    const style = sqlStyles[t.type as keyof typeof sqlStyles]
    if (style) {
      return `<span style="${style}">${t.value}</span>`
    }
    return t.value
  }).join('')
}

interface QueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  executionTime: number
}

interface TableSchema {
  table: string
  description?: string
  columns: { name: string; type: string; description?: string; pk?: boolean; fk?: string }[]
}

type ChartType = 'bar' | 'line' | 'pie' | 'grouped_bar' | 'stacked_bar' | 'grouped_line'
type ViewMode = 'table' | 'chart' | 'schema' | 'queries'
type Visualization = '2d' | '3d'

interface ChartConfig {
  type: ChartType
  labelColumn: string
  valueColumn: string
  groupColumn?: string  // For grouped charts
  orientation?: 'horizontal' | 'vertical'
  visualization: Visualization
  title?: string        // From @name metadata
  description?: string  // From @description metadata
}

// ER Diagram Component - Focused view with selected table in center
function ERDiagram({ 
  selectedTable, 
  tableSchema,
  schemaMetadata,
  onSelectTable 
}: { 
  selectedTable: string | null
  tableSchema: TableSchema | null
  schemaMetadata: SchemaMetadata | null
  onSelectTable: (table: string) => void 
}) {
  // Get relationships from schema metadata
  const relationships = schemaMetadata?.relationships || []
  
  // Detect theme for SVG colors
  const [isDark, setIsDark] = useState(() => 
    document.documentElement.getAttribute('data-theme') !== 'light'
  )
  
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'data-theme') {
          setIsDark(document.documentElement.getAttribute('data-theme') !== 'light')
        }
      })
    })
    observer.observe(document.documentElement, { attributes: true })
    return () => observer.disconnect()
  }, [])
  
  // Theme-aware colors for SVG elements
  const colors = {
    tableBg: isDark ? 'rgba(17, 24, 39, 0.95)' : 'rgba(255, 255, 255, 0.98)',
    relatedTableBg: isDark ? 'rgba(17, 24, 39, 0.9)' : 'rgba(255, 255, 255, 0.95)',
    tableBorder: isDark ? 'rgba(99, 102, 241, 0.4)' : 'rgba(99, 102, 241, 0.5)',
    relatedBorder: isDark ? 'rgba(99, 102, 241, 0.25)' : 'rgba(99, 102, 241, 0.35)',
    childBorder: isDark ? 'rgba(148, 163, 184, 0.15)' : 'rgba(148, 163, 184, 0.4)',
    linePrimary: isDark ? 'rgba(99, 102, 241, 0.25)' : 'rgba(99, 102, 241, 0.4)',
    lineSecondary: isDark ? 'rgba(148, 163, 184, 0.2)' : 'rgba(148, 163, 184, 0.4)',
    headerLine: isDark ? 'rgba(99, 102, 241, 0.2)' : 'rgba(99, 102, 241, 0.3)',
  }
  
  // Get related tables for the selected table
  const getRelatedTables = (table: string) => {
    const related: { table: string; relationship: TableRelationship; direction: 'parent' | 'child' }[] = []
    for (const rel of relationships) {
      if (rel.from === table) {
        related.push({ table: rel.to, relationship: rel, direction: 'parent' })
      }
      if (rel.to === table) {
        related.push({ table: rel.from, relationship: rel, direction: 'child' })
      }
    }
    return related
  }

  // If no table selected, show a simple overview
  if (!selectedTable) {
    const allTables = Object.keys(TABLES).sort()
    return (
      <div className={styles.erOverview}>
        <div className={styles.erOverviewTitle}>Select a table to explore</div>
        <div className={styles.erOverviewGrid}>
          {allTables.map(table => (
            <button
              key={table}
              className={styles.erOverviewTable}
              onClick={() => onSelectTable(table)}
            >
              {table}
            </button>
          ))}
        </div>
      </div>
    )
  }

  const relatedTables = getRelatedTables(selectedTable)
  const parentTables = relatedTables.filter(r => r.direction === 'parent')
  const childTables = relatedTables.filter(r => r.direction === 'child')
  
  const columns = tableSchema?.columns || []
  const rowHeight = 18
  const tableHeight = 36 + columns.length * rowHeight
  
  // Calculate height needed for each section
  const centerTableHeight = tableHeight + 80
  const parentTablesHeight = parentTables.length > 0 ? 60 + parentTables.length * 55 + 40 : 0
  const childTablesHeight = childTables.length > 0 ? 50 + childTables.length * 48 + 40 : 0
  
  // SVG height should accommodate all sections
  const svgHeight = Math.max(400, centerTableHeight, parentTablesHeight, childTablesHeight)
  const centerX = 400
  const centerY = svgHeight / 2
  
  return (
    <svg 
      viewBox={`0 0 800 ${svgHeight}`}
      className={styles.erDiagram}
    >
      {/* Connection lines */}
      {parentTables.map((_, i) => {
        const endY = 60 + i * 55
        return (
          <path
            key={`parent-line-${i}`}
            d={`M ${centerX - 100} ${centerY} Q ${centerX - 160} ${centerY}, ${centerX - 160} ${(centerY + endY) / 2} Q ${centerX - 160} ${endY}, ${155} ${endY}`}
            fill="none"
            stroke={colors.linePrimary}
            strokeWidth="1"
          />
        )
      })}
      
      {childTables.map((_, i) => {
        const endY = 50 + i * 48
        return (
          <path
            key={`child-line-${i}`}
            d={`M ${centerX + 100} ${centerY} Q ${centerX + 160} ${centerY}, ${centerX + 160} ${(centerY + endY) / 2} Q ${centerX + 160} ${endY}, ${645} ${endY}`}
            fill="none"
            stroke={colors.lineSecondary}
            strokeWidth="1"
          />
        )
      })}

      {/* Parent tables (left side) */}
      {parentTables.map((rel, i) => {
        const y = 60 + i * 55
        return (
          <g 
            key={`parent-${i}`}
            className={styles.erRelatedTable}
            onClick={() => onSelectTable(rel.table)}
          >
            <rect
              x={25}
              y={y - 14}
              width={130}
              height={28}
              rx={2}
              fill={colors.relatedTableBg}
              stroke={colors.relatedBorder}
              strokeWidth="1"
            />
            <text x={90} y={y + 4} textAnchor="middle" className={styles.erRelatedTableName}>
              {rel.table}
            </text>
          </g>
        )
      })}

      {/* Child tables (right side) */}
      {childTables.map((rel, i) => {
        const y = 50 + i * 48
        return (
          <g 
            key={`child-${i}`}
            className={styles.erRelatedTable}
            onClick={() => onSelectTable(rel.table)}
          >
            <rect
              x={645}
              y={y - 14}
              width={130}
              height={28}
              rx={2}
              fill={colors.relatedTableBg}
              stroke={colors.childBorder}
              strokeWidth="1"
            />
            <text x={710} y={y + 4} textAnchor="middle" className={styles.erRelatedTableName}>
              {rel.table}
            </text>
          </g>
        )
      })}

      {/* Center table card */}
      <rect
        x={centerX - 100}
        y={centerY - tableHeight/2}
        width={200}
        height={tableHeight}
        rx={2}
        fill={colors.tableBg}
        stroke={colors.tableBorder}
        strokeWidth="1"
      />
      
      {/* Table name header */}
      <line
        x1={centerX - 100}
        y1={centerY - tableHeight/2 + 28}
        x2={centerX + 100}
        y2={centerY - tableHeight/2 + 28}
        stroke={colors.headerLine}
        strokeWidth="1"
      />
      
      <text
        x={centerX}
        y={centerY - tableHeight/2 + 18}
        textAnchor="middle"
        className={styles.erCenterTableName}
      >
        <title>{tableSchema?.description || selectedTable}</title>
        {selectedTable}
      </text>

      {/* Column list - show ALL columns */}
      {columns.map((col, i) => {
        const y = centerY - tableHeight/2 + 44 + i * rowHeight
        // Use schema metadata for FK detection
        const hasFk = col.fk !== undefined
        const hasPk = col.pk === true
        // Color code by type
        const typeColor = col.type === 'VARCHAR[]' ? '#86efac' :  // light green for string arrays
                         col.type.includes('VARCHAR') ? '#22c55e' :
                         col.type.includes('INTEGER') || col.type.includes('BIGINT') ? '#f59e0b' :
                         col.type.includes('BOOLEAN') ? '#ec4899' :
                         col.type.includes('[]') ? '#06b6d4' :  // cyan for other arrays
                         col.type.includes('JSON') ? '#8b5cf6' :
                         '#94a3b8'
        // Build prefix for PK/FK indicators
        const prefix = hasPk ? '◆ ' : hasFk ? '› ' : ''
        return (
          <g key={col.name}>
            {/* Column name with PK/FK indicator */}
            <text x={centerX - 92} y={y} className={styles.erColumnName}>
              <title>{col.description || col.name}{hasPk ? ' (Primary Key)' : ''}{hasFk ? ` (FK → ${col.fk})` : ''}</title>
              {prefix}{col.name}
            </text>
            <text x={centerX + 92} y={y} textAnchor="end" style={{ fill: typeColor }} className={styles.erColumnType}>
              {col.type.length > 12 ? col.type.slice(0, 12) + '…' : col.type}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// Color palette for charts
const CHART_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#f43f5e', '#f97316', '#eab308', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6',
]

// Stage-specific colors
const STAGE_COLORS: Record<string, string> = {
  stable: '#10b981',
  beta: '#f59e0b', 
  alpha: '#8b5cf6',
}

interface ChartDataPoint {
  label: string
  value: number
  color: string
}

interface GroupedChartData {
  label: string
  groups: { name: string; value: number; color: string }[]
}

// Grouped Bar Chart Component
function GroupedBarChart({ data, orientation = 'vertical' }: { data: GroupedChartData[], orientation?: 'horizontal' | 'vertical' }) {
  if (data.length === 0) return null
  
  const allValues = data.flatMap(d => d.groups.map(g => g.value))
  const maxValue = Math.max(...allValues)
  const groupNames = [...new Set(data.flatMap(d => d.groups.map(g => g.name)))]
  
  if (orientation === 'vertical') {
    // Vertical bars (labels on x-axis)
    const width = Math.max(600, data.length * 80)
    const height = 350
    const padding = { top: 30, right: 30, bottom: 80, left: 50 }
    const chartWidth = width - padding.left - padding.right
    const chartHeight = height - padding.top - padding.bottom
    const groupWidth = chartWidth / data.length
    const barWidth = Math.min(20, (groupWidth - 10) / groupNames.length)
    
    return (
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={styles.chart}>
        {/* Y-axis grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
          const y = padding.top + chartHeight * (1 - t)
          const value = Math.round(maxValue * t)
          return (
            <g key={i}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} className={styles.chartGridLine} />
              <text x={padding.left - 8} y={y} textAnchor="end" dominantBaseline="middle" className={styles.chartAxisLabel}>
                {value}
              </text>
            </g>
          )
        })}
        
        {/* Bars */}
        {data.map((d, i) => {
          const groupX = padding.left + i * groupWidth + groupWidth / 2
          return (
            <g key={i}>
              {d.groups.map((g, j) => {
                const barHeight = maxValue > 0 ? (g.value / maxValue) * chartHeight : 0
                const barX = groupX - (d.groups.length * barWidth) / 2 + j * barWidth
                return (
                  <g key={j}>
                    <rect
                      x={barX}
                      y={padding.top + chartHeight - barHeight}
                      width={barWidth - 2}
                      height={barHeight}
                      fill={g.color}
                      rx={2}
                      className={styles.chartBar}
                    />
                    {barHeight > 15 && (
                      <text
                        x={barX + (barWidth - 2) / 2}
                        y={padding.top + chartHeight - barHeight + 12}
                        textAnchor="middle"
                        className={styles.chartBarValue}
                      >
                        {g.value}
                      </text>
                    )}
                  </g>
                )
              })}
              {/* X-axis label */}
              <text
                x={groupX}
                y={height - padding.bottom + 16}
                textAnchor="middle"
                className={styles.chartAxisLabel}
                transform={`rotate(-45, ${groupX}, ${height - padding.bottom + 16})`}
              >
                {d.label.length > 12 ? d.label.slice(0, 12) + '…' : d.label}
              </text>
            </g>
          )
        })}
        
        {/* Legend */}
        <g transform={`translate(${width - padding.right - 100}, ${padding.top})`}>
          {groupNames.map((name, i) => (
            <g key={i} transform={`translate(0, ${i * 20})`}>
              <rect width={12} height={12} fill={STAGE_COLORS[name] || CHART_COLORS[i % CHART_COLORS.length]} rx={2} />
              <text x={18} y={10} className={styles.chartLegendText}>{name}</text>
            </g>
          ))}
        </g>
      </svg>
    )
  }
  
  // Horizontal bars (default)
  const height = Math.max(300, data.length * 60)
  const width = 600
  const padding = { top: 30, right: 120, bottom: 20, left: 120 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom
  const groupHeight = chartHeight / data.length
  const barHeight = Math.min(16, (groupHeight - 10) / groupNames.length)
  
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={styles.chart}>
      {data.map((d, i) => {
        const groupY = padding.top + i * groupHeight + groupHeight / 2
        return (
          <g key={i}>
            {/* Label */}
            <text x={padding.left - 8} y={groupY} textAnchor="end" dominantBaseline="middle" className={styles.chartLabel}>
              {d.label.length > 15 ? d.label.slice(0, 15) + '…' : d.label}
            </text>
            {/* Bars for each group */}
            {d.groups.map((g, j) => {
              const barWidth = maxValue > 0 ? (g.value / maxValue) * chartWidth : 0
              const barY = groupY - (d.groups.length * barHeight) / 2 + j * barHeight
              return (
                <g key={j}>
                  <rect
                    x={padding.left}
                    y={barY}
                    width={barWidth}
                    height={barHeight - 2}
                    fill={g.color}
                    rx={2}
                    className={styles.chartBar}
                  />
                  <text
                    x={padding.left + barWidth + 4}
                    y={barY + (barHeight - 2) / 2}
                    dominantBaseline="middle"
                    className={styles.chartValue}
                  >
                    {g.value}
                  </text>
                </g>
              )
            })}
          </g>
        )
      })}
      
      {/* Legend */}
      <g transform={`translate(${width - padding.right + 20}, ${padding.top})`}>
        {groupNames.map((name, i) => (
          <g key={i} transform={`translate(0, ${i * 20})`}>
            <rect width={12} height={12} fill={STAGE_COLORS[name] || CHART_COLORS[i % CHART_COLORS.length]} rx={2} />
            <text x={18} y={10} className={styles.chartLegendText}>{name}</text>
          </g>
        ))}
      </g>
    </svg>
  )
}

// Stacked Bar Chart Component
function StackedBarChart({ data, orientation = 'vertical' }: { data: GroupedChartData[], orientation?: 'horizontal' | 'vertical' }) {
  if (data.length === 0) return null
  
  // Calculate max stacked value (sum of all groups per label)
  const stackedTotals = data.map(d => d.groups.reduce((sum, g) => sum + g.value, 0))
  const maxValue = Math.max(...stackedTotals)
  const groupNames = [...new Set(data.flatMap(d => d.groups.map(g => g.name)))]
  
  if (orientation === 'vertical') {
    const width = Math.max(600, data.length * 60)
    const height = 350
    const padding = { top: 30, right: 30, bottom: 80, left: 50 }
    const chartWidth = width - padding.left - padding.right
    const chartHeight = height - padding.top - padding.bottom
    const barWidth = Math.min(40, chartWidth / data.length - 10)
    
    return (
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={styles.chart}>
        {/* Y-axis grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
          const y = padding.top + chartHeight * (1 - t)
          const value = Math.round(maxValue * t)
          return (
            <g key={i}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} className={styles.chartGridLine} />
              <text x={padding.left - 8} y={y} textAnchor="end" dominantBaseline="middle" className={styles.chartAxisLabel}>
                {value}
              </text>
            </g>
          )
        })}
        
        {/* Stacked Bars */}
        {data.map((d, i) => {
          const barX = padding.left + (i + 0.5) * (chartWidth / data.length) - barWidth / 2
          let currentY = padding.top + chartHeight
          
          return (
            <g key={i}>
              {d.groups.map((g, j) => {
                const segmentHeight = maxValue > 0 ? (g.value / maxValue) * chartHeight : 0
                currentY -= segmentHeight
                return (
                  <g key={j}>
                    <rect
                      x={barX}
                      y={currentY}
                      width={barWidth}
                      height={segmentHeight}
                      fill={g.color}
                      className={styles.chartBar}
                    />
                    {segmentHeight > 15 && (
                      <text
                        x={barX + barWidth / 2}
                        y={currentY + segmentHeight / 2}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className={styles.chartBarValue}
                      >
                        {g.value}
                      </text>
                    )}
                  </g>
                )
              })}
              {/* X-axis label */}
              <text
                x={barX + barWidth / 2}
                y={height - padding.bottom + 16}
                textAnchor="middle"
                className={styles.chartAxisLabel}
                transform={`rotate(-45, ${barX + barWidth / 2}, ${height - padding.bottom + 16})`}
              >
                {d.label.length > 12 ? d.label.slice(0, 12) + '…' : d.label}
              </text>
            </g>
          )
        })}
        
        {/* Legend */}
        <g transform={`translate(${width - padding.right - 100}, ${padding.top})`}>
          {groupNames.map((name, i) => (
            <g key={i} transform={`translate(0, ${i * 20})`}>
              <rect width={12} height={12} fill={STAGE_COLORS[name] || CHART_COLORS[i % CHART_COLORS.length]} rx={2} />
              <text x={18} y={10} className={styles.chartLegendText}>{name}</text>
            </g>
          ))}
        </g>
      </svg>
    )
  }
  
  // Horizontal stacked bars
  const height = Math.max(300, data.length * 40)
  const width = 600
  const padding = { top: 30, right: 120, bottom: 20, left: 120 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom
  const barHeight = Math.min(30, chartHeight / data.length - 8)
  
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={styles.chart}>
      {data.map((d, i) => {
        const barY = padding.top + (i + 0.5) * (chartHeight / data.length) - barHeight / 2
        let currentX = padding.left
        const total = d.groups.reduce((sum, g) => sum + g.value, 0)
        
        return (
          <g key={i}>
            {/* Label */}
            <text x={padding.left - 8} y={barY + barHeight / 2} textAnchor="end" dominantBaseline="middle" className={styles.chartLabel}>
              {d.label.length > 15 ? d.label.slice(0, 15) + '…' : d.label}
            </text>
            {/* Stacked segments */}
            {d.groups.map((g, j) => {
              const segmentWidth = maxValue > 0 ? (g.value / maxValue) * chartWidth : 0
              const x = currentX
              currentX += segmentWidth
              return (
                <g key={j}>
                  <rect
                    x={x}
                    y={barY}
                    width={segmentWidth}
                    height={barHeight}
                    fill={g.color}
                    className={styles.chartBar}
                  />
                  {segmentWidth > 25 && (
                    <text
                      x={x + segmentWidth / 2}
                      y={barY + barHeight / 2}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className={styles.chartBarValue}
                    >
                      {g.value}
                    </text>
                  )}
                </g>
              )
            })}
            {/* Total */}
            <text
              x={currentX + 4}
              y={barY + barHeight / 2}
              dominantBaseline="middle"
              className={styles.chartValue}
            >
              {total}
            </text>
          </g>
        )
      })}
      
      {/* Legend */}
      <g transform={`translate(${width - padding.right + 20}, ${padding.top})`}>
        {groupNames.map((name, i) => (
          <g key={i} transform={`translate(0, ${i * 20})`}>
            <rect width={12} height={12} fill={STAGE_COLORS[name] || CHART_COLORS[i % CHART_COLORS.length]} rx={2} />
            <text x={18} y={10} className={styles.chartLegendText}>{name}</text>
          </g>
        ))}
      </g>
    </svg>
  )
}

// Bar Chart Component
function BarChart({ data }: { data: ChartDataPoint[] }) {
  if (data.length === 0) return null
  
  const maxValue = Math.max(...data.map(d => d.value))
  const width = 600
  const height = Math.max(300, data.length * 28)
  const barHeight = 20
  const labelWidth = 120
  const padding = { top: 20, right: 60, bottom: 20, left: labelWidth }
  const chartWidth = width - padding.left - padding.right
  
  return (
    <svg 
      viewBox={`0 0 ${width} ${height}`} 
      width={width} 
      height={height}
      className={styles.chart}
    >
      {data.map((d, i) => {
        const barWidth = maxValue > 0 ? (d.value / maxValue) * chartWidth : 0
        const y = padding.top + i * (barHeight + 8)
        
        return (
          <g key={i}>
            <text
              x={padding.left - 8}
              y={y + barHeight / 2}
              textAnchor="end"
              dominantBaseline="middle"
              className={styles.chartLabel}
            >
              {d.label.length > 15 ? d.label.slice(0, 15) + '…' : d.label}
            </text>
            <rect
              x={padding.left}
              y={y}
              width={barWidth}
              height={barHeight}
              fill={d.color}
              rx={3}
              className={styles.chartBar}
            />
            <text
              x={padding.left + barWidth + 6}
              y={y + barHeight / 2}
              dominantBaseline="middle"
              className={styles.chartValue}
            >
              {d.value.toLocaleString()}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// Line Chart Component
function LineChart({ data }: { data: ChartDataPoint[] }) {
  if (data.length === 0) return null
  
  const maxValue = Math.max(...data.map(d => d.value))
  const minValue = Math.min(...data.map(d => d.value))
  const width = 600
  const height = 300
  const padding = { top: 30, right: 30, bottom: 50, left: 60 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom
  
  const xScale = (i: number) => padding.left + (i / (data.length - 1 || 1)) * chartWidth
  const yScale = (v: number) => {
    const range = maxValue - minValue || 1
    return padding.top + chartHeight - ((v - minValue) / range) * chartHeight
  }
  
  const linePath = data.map((d, i) => 
    `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(d.value)}`
  ).join(' ')
  
  return (
    <svg 
      viewBox={`0 0 ${width} ${height}`} 
      width={width} 
      height={height}
      className={styles.chart}
    >
      {/* Y-axis labels */}
      {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
        const value = minValue + t * (maxValue - minValue)
        const y = yScale(value)
        return (
          <g key={i}>
            <line
              x1={padding.left}
              y1={y}
              x2={width - padding.right}
              y2={y}
              className={styles.chartGridLine}
            />
            <text
              x={padding.left - 8}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              className={styles.chartAxisLabel}
            >
              {Math.round(value).toLocaleString()}
            </text>
          </g>
        )
      })}
      
      {/* Line */}
      <path d={linePath} fill="none" stroke="#6366f1" strokeWidth={2} />
      
      {/* Points */}
      {data.map((d, i) => (
        <g key={i}>
          <circle
            cx={xScale(i)}
            cy={yScale(d.value)}
            r={4}
            fill="#6366f1"
            className={styles.chartPoint}
          />
          {/* X-axis labels (show every nth for readability) */}
          {(data.length <= 15 || i % Math.ceil(data.length / 15) === 0) && (
            <text
              x={xScale(i)}
              y={height - padding.bottom + 16}
              textAnchor="middle"
              className={styles.chartAxisLabel}
              transform={`rotate(-45, ${xScale(i)}, ${height - padding.bottom + 16})`}
            >
              {d.label.length > 10 ? d.label.slice(0, 10) + '…' : d.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}

// Provider-specific colors for grouped line chart
const PROVIDER_COLORS_2D: Record<string, string> = {
  'Amazon EKS': '#ff9900',
  'Azure AKS': '#0078d4',
  'Google GKE': '#34a853',      // Google green (more distinct from Azure blue)
  'Red Hat OpenShift': '#ee0000',
}

// Grouped Line Chart Component - multiple lines on the same chart
function GroupedLineChart({ data }: { data: GroupedChartData[] }) {
  const [hoveredLine, setHoveredLine] = useState<string | null>(null)
  
  if (data.length === 0) return null
  
  // Get all unique group names (providers)
  const groupNames = [...new Set(data.flatMap(d => d.groups.map(g => g.name)))]
  
  // Calculate min/max across all values
  const allValues = data.flatMap(d => d.groups.map(g => g.value)).filter(v => v > 0)
  const maxValue = Math.max(...allValues, 1)
  const minValue = Math.min(...allValues, 0)
  const range = maxValue - minValue || 1
  
  const width = 700
  const height = 350
  const padding = { top: 30, right: 150, bottom: 60, left: 60 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom
  
  const xScale = (i: number) => padding.left + (i / (data.length - 1 || 1)) * chartWidth
  const yScale = (v: number) => {
    if (v <= 0) return padding.top + chartHeight
    return padding.top + chartHeight - ((v - minValue) / range) * chartHeight
  }
  
  // Create line data for each group
  const lineData = groupNames.map((groupName, gi) => {
    const color = PROVIDER_COLORS_2D[groupName] || STAGE_COLORS[groupName] || CHART_COLORS[gi % CHART_COLORS.length]
    const points = data.map((d, i) => {
      const group = d.groups.find(g => g.name === groupName)
      const value = group?.value || 0
      return {
        x: xScale(i),
        y: yScale(value),
        value,
        label: d.label,
        hasValue: value > 0,
      }
    })
    
    // Create path only for consecutive points with values
    const pathSegments: string[] = []
    let currentPath = ''
    points.forEach((p) => {
      if (p.hasValue) {
        if (currentPath === '') {
          currentPath = `M ${p.x} ${p.y}`
        } else {
          currentPath += ` L ${p.x} ${p.y}`
        }
      } else if (currentPath !== '') {
        pathSegments.push(currentPath)
        currentPath = ''
      }
    })
    if (currentPath !== '') pathSegments.push(currentPath)
    
    return { name: groupName, color, points, pathSegments }
  })
  
  return (
    <svg 
      viewBox={`0 0 ${width} ${height}`} 
      width={width} 
      height={height}
      className={styles.chart}
    >
      {/* Y-axis grid lines and labels */}
      {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
        const value = Math.round(minValue + t * range)
        const y = yScale(value)
        return (
          <g key={i}>
            <line
              x1={padding.left}
              y1={y}
              x2={width - padding.right}
              y2={y}
              className={styles.chartGridLine}
            />
            <text
              x={padding.left - 8}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              className={styles.chartAxisLabel}
            >
              {value.toLocaleString()}
            </text>
          </g>
        )
      })}
      
      {/* Lines for each group */}
      {lineData.map((line, li) => {
        const isHovered = hoveredLine === line.name
        const isOtherHovered = hoveredLine !== null && hoveredLine !== line.name
        
        return (
          <g key={li} opacity={isOtherHovered ? 0.2 : 1}>
            {/* Line paths */}
            {line.pathSegments.map((path, pi) => (
              <path
                key={pi}
                d={path}
                fill="none"
                stroke={line.color}
                strokeWidth={isHovered ? 3 : 2}
                style={{ transition: 'stroke-width 0.15s ease, opacity 0.15s ease' }}
              />
            ))}
            
            {/* Data points */}
            {line.points.map((p, pi) => {
              if (!p.hasValue) return null
              return (
                <circle
                  key={pi}
                  cx={p.x}
                  cy={p.y}
                  r={isHovered ? 5 : 4}
                  fill={line.color}
                  className={styles.chartPoint}
                  onMouseEnter={() => setHoveredLine(line.name)}
                  onMouseLeave={() => setHoveredLine(null)}
                  style={{ cursor: 'pointer' }}
                />
              )
            })}
          </g>
        )
      })}
      
      {/* X-axis labels */}
      {data.map((d, i) => {
        // Show all labels if <= 12 items, otherwise show every nth
        const showLabel = data.length <= 12 || i % Math.ceil(data.length / 12) === 0
        if (!showLabel) return null
        return (
          <text
            key={i}
            x={xScale(i)}
            y={height - padding.bottom + 16}
            textAnchor="middle"
            className={styles.chartAxisLabel}
            transform={`rotate(-45, ${xScale(i)}, ${height - padding.bottom + 16})`}
          >
            {d.label.length > 8 ? d.label.slice(0, 8) + '…' : d.label}
          </text>
        )
      })}
      
      {/* Legend */}
      <g transform={`translate(${width - padding.right + 15}, ${padding.top})`}>
        <text className={styles.chartLegendTitle} y={-5}>Providers</text>
        {groupNames.map((name, i) => {
          const color = PROVIDER_COLORS_2D[name] || STAGE_COLORS[name] || CHART_COLORS[i % CHART_COLORS.length]
          const isHovered = hoveredLine === name
          return (
            <g 
              key={i} 
              transform={`translate(0, ${i * 22 + 10})`}
              onMouseEnter={() => setHoveredLine(name)}
              onMouseLeave={() => setHoveredLine(null)}
              style={{ cursor: 'pointer' }}
            >
              <line x1={0} y1={6} x2={20} y2={6} stroke={color} strokeWidth={isHovered ? 3 : 2} />
              <circle cx={10} cy={6} r={isHovered ? 4 : 3} fill={color} />
              <text 
                x={26} 
                y={10} 
                className={styles.chartLegendText}
                style={{ fontWeight: isHovered ? 600 : 400 }}
              >
                {name.length > 14 ? name.slice(0, 14) + '…' : name}
              </text>
            </g>
          )
        })}
      </g>
    </svg>
  )
}

// Pie Chart Component
function PieChart({ data }: { data: ChartDataPoint[] }) {
  const [hoveredSlice, setHoveredSlice] = useState<number | null>(null)
  
  if (data.length === 0) return null
  
  const total = data.reduce((sum, d) => sum + d.value, 0)
  const width = 500
  const height = 350
  const radius = 120
  const centerX = 180
  const centerY = height / 2
  
  let currentAngle = -Math.PI / 2 // Start from top
  
  const slices = data.map((d) => {
    const angle = total > 0 ? (d.value / total) * 2 * Math.PI : 0
    const startAngle = currentAngle
    const endAngle = currentAngle + angle
    const midAngle = (startAngle + endAngle) / 2
    currentAngle = endAngle
    
    const x1 = centerX + radius * Math.cos(startAngle)
    const y1 = centerY + radius * Math.sin(startAngle)
    const x2 = centerX + radius * Math.cos(endAngle)
    const y2 = centerY + radius * Math.sin(endAngle)
    
    // Position for tooltip (middle of slice, slightly outside)
    const tooltipRadius = radius * 0.7
    const tooltipX = centerX + tooltipRadius * Math.cos(midAngle)
    const tooltipY = centerY + tooltipRadius * Math.sin(midAngle)
    
    const largeArc = angle > Math.PI ? 1 : 0
    
    return {
      ...d,
      path: `M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`,
      percentage: total > 0 ? ((d.value / total) * 100).toFixed(1) : '0',
      tooltipX,
      tooltipY,
    }
  })
  
  return (
    <svg 
      viewBox={`0 0 ${width} ${height}`} 
      width={width} 
      height={height}
      className={styles.chart}
    >
      {slices.map((slice, i) => (
        <path
          key={i}
          d={slice.path}
          fill={slice.color}
          stroke="#030712"
          strokeWidth={1}
          className={styles.chartSlice}
          onMouseEnter={() => setHoveredSlice(i)}
          onMouseLeave={() => setHoveredSlice(null)}
          style={{ opacity: hoveredSlice !== null && hoveredSlice !== i ? 0.5 : 1 }}
        />
      ))}
      
      {/* Hover tooltip */}
      {hoveredSlice !== null && (
        <g style={{ pointerEvents: 'none' }}>
          <rect
            x={slices[hoveredSlice].tooltipX - 45}
            y={slices[hoveredSlice].tooltipY - 22}
            width={90}
            height={44}
            rx={4}
            fill="rgba(3, 7, 18, 0.9)"
            stroke="rgba(148, 163, 184, 0.3)"
          />
          <text
            x={slices[hoveredSlice].tooltipX}
            y={slices[hoveredSlice].tooltipY - 6}
            textAnchor="middle"
            className={styles.chartTooltipValue}
          >
            {slices[hoveredSlice].value.toLocaleString()}
          </text>
          <text
            x={slices[hoveredSlice].tooltipX}
            y={slices[hoveredSlice].tooltipY + 12}
            textAnchor="middle"
            className={styles.chartTooltipPercent}
          >
            {slices[hoveredSlice].percentage}%
          </text>
        </g>
      )}
      
      {/* Legend - positioned at bottom right */}
      <g transform={`translate(${centerX + radius + 40}, ${height - Math.min(data.length, 12) * 24 - 20})`}>
        {data.slice(0, 12).map((d, i) => (
          <g 
            key={i} 
            transform={`translate(0, ${i * 24})`}
            style={{ opacity: hoveredSlice !== null && hoveredSlice !== i ? 0.5 : 1 }}
            onMouseEnter={() => setHoveredSlice(i)}
            onMouseLeave={() => setHoveredSlice(null)}
            className={styles.chartLegendItem}
          >
            <rect width={14} height={14} fill={d.color} rx={2} />
            <text x={20} y={11} className={styles.chartLegendText}>
              {d.label.length > 18 ? d.label.slice(0, 18) + '…' : d.label}
            </text>
            <text x={170} y={11} className={styles.chartLegendValue}>
              {d.value.toLocaleString()}
            </text>
          </g>
        ))}
        {data.length > 12 && (
          <text y={12 * 24 + 10} className={styles.chartLegendMore}>
            +{data.length - 12} more...
          </text>
        )}
      </g>
    </svg>
  )
}

// Helper functions for numeric value handling (outside component to avoid recreation)
function extractNumericValue(val: unknown): number {
  if (typeof val === 'number') return val
  if (typeof val === 'bigint') return Number(val)
  if (typeof val === 'string' && !isNaN(Number(val))) return Number(val)
  // DuckDB sometimes returns aggregates as objects like {"0": value}
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>
    const firstKey = Object.keys(obj)[0]
    if (firstKey !== undefined) {
      const innerVal = obj[firstKey]
      if (typeof innerVal === 'number') return innerVal
      if (typeof innerVal === 'bigint') return Number(innerVal)
    }
  }
  return 0
}

function isNumericValue(val: unknown): boolean {
  if (typeof val === 'number') return true
  if (typeof val === 'bigint') return true
  if (typeof val === 'string' && !isNaN(Number(val)) && val.trim() !== '') return true
  // DuckDB aggregate objects
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>
    const firstKey = Object.keys(obj)[0]
    if (firstKey !== undefined) {
      const innerVal = obj[firstKey]
      return typeof innerVal === 'number' || typeof innerVal === 'bigint'
    }
  }
  return false
}

export function AnalyticsView() {
  const { analyticsUrlState, setAnalyticsUrlState } = useExplorerStore()
  
  // Initialize from URL state
  const initialPreset = analyticsUrlState.preset !== undefined 
    ? PRESET_QUERIES[analyticsUrlState.preset] 
    : PRESET_QUERIES[0]
  const initialSql = analyticsUrlState.sql || initialPreset?.sql || PRESET_QUERIES[0].sql
  
  const [sql, setSql] = useState(initialSql)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tableSchema, setTableSchema] = useState<TableSchema | null>(null)
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>(analyticsUrlState.view || 'table')
  const [copied, setCopied] = useState(false)
  const [querySearch, setQuerySearch] = useState('')
  const [sortConfig, setSortConfig] = useState<{ column: string; direction: 'asc' | 'desc' } | null>(null)
  const [chartConfig, setChartConfig] = useState<ChartConfig>({
    type: (analyticsUrlState.chartType as ChartType) || 'bar',
    labelColumn: analyticsUrlState.chartLabels || '',
    valueColumn: analyticsUrlState.chartValues || '',
    groupColumn: analyticsUrlState.chartGroup,
    visualization: analyticsUrlState.chartStyle || '2d',
  })
  const [isChartFullscreen, setIsChartFullscreen] = useState(analyticsUrlState.fullscreen || false)
  const [editorHeight, setEditorHeight] = useState(280)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const isDragging = useRef(false)
  
  // Load schema metadata for ER diagram and column descriptions
  const { metadata: schemaMetadata } = useSchemaMetadata()
  
  // Track if we've auto-executed the first query
  const hasAutoExecuted = useRef(false)
  
  // Refs for SQL editor scroll sync
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  
  // Find preset index for current SQL
  const findPresetIndex = useCallback((sqlText: string): number | undefined => {
    const index = PRESET_QUERIES.findIndex(p => p.sql.trim() === sqlText.trim())
    return index >= 0 ? index : undefined
  }, [])
  
  // Update URL state helper - call after query runs or view changes
  const syncUrlState = useCallback((sqlText: string, view: ViewMode, chart: ChartConfig, fullscreen?: boolean) => {
    const presetIndex = findPresetIndex(sqlText)
    setAnalyticsUrlState({
      preset: presetIndex,
      sql: presetIndex === undefined ? sqlText : undefined,
      view: view !== 'table' ? view : undefined,
      chartType: view === 'chart' ? chart.type : undefined,
      chartLabels: view === 'chart' ? chart.labelColumn : undefined,
      chartValues: view === 'chart' ? chart.valueColumn : undefined,
      chartGroup: view === 'chart' ? chart.groupColumn : undefined,
      chartStyle: view === 'chart' && chart.visualization !== '2d' ? chart.visualization : undefined,
      fullscreen: view === 'chart' && fullscreen ? true : undefined,
    })
  }, [findPresetIndex, setAnalyticsUrlState])
  
  // Handle fullscreen change from chart components
  const handleChartFullscreenChange = useCallback((fs: boolean) => {
    setIsChartFullscreen(fs)
    syncUrlState(sql, viewMode, chartConfig, fs)
  }, [sql, viewMode, chartConfig, syncUrlState])
  
  // Handle view mode change - reset fullscreen when leaving chart view
  const handleViewModeChange = useCallback((newMode: ViewMode) => {
    if (newMode !== 'chart' && isChartFullscreen) {
      setIsChartFullscreen(false)
    }
    setViewMode(newMode)
    if (newMode === 'table' || newMode === 'chart') {
      syncUrlState(sql, newMode, chartConfig, newMode === 'chart' ? isChartFullscreen : undefined)
    }
  }, [sql, chartConfig, isChartFullscreen, syncUrlState])
  
  // Sync scroll between textarea and highlight layer
  const handleTextareaScroll = useCallback(() => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }, [])

  // Handle resizer drag
  const handleResizerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    const startY = e.clientY
    const startHeight = editorHeight

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = e.clientY - startY
      const newHeight = Math.max(100, Math.min(600, startHeight + delta))
      setEditorHeight(newHeight)
    }

    const handleMouseUp = () => {
      isDragging.current = false
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [editorHeight])

  // Parse chart directive from SQL comments
  // Format: -- @chart: type=grouped_bar labels=sig group=stage values=count orientation=vertical style=3d
  // Also supports legacy format without @: -- chart: ...
  // Additionally extracts title and description from @meta directive
  const parseChartDirective = useCallback((sqlText: string): Partial<ChartConfig> | null => {
    const chartMatch = sqlText.match(/--\s*@?chart:\s*(.+)/i)
    if (!chartMatch) return null
    
    const directive = chartMatch[1]
    const config: Partial<ChartConfig> = {}
    
    // Extract title and description from @meta directive (new format)
    const metaMatch = sqlText.match(/--\s*@meta:\s*(.+)/i)
    if (metaMatch) {
      const metaStr = metaMatch[1]
      const titleMatch = metaStr.match(/title='([^']+)'/)
      const descMatch = metaStr.match(/description='([^']+)'/)
      if (titleMatch) config.title = titleMatch[1].trim()
      if (descMatch) config.description = descMatch[1].trim()
    } else {
      // Fallback to legacy @name/@description format
      const nameMatch = sqlText.match(/--\s*@name:\s*(.+)/i)
      const descMatch = sqlText.match(/--\s*@description:\s*(.+)/i)
      if (nameMatch) config.title = nameMatch[1].trim()
      if (descMatch) config.description = descMatch[1].trim()
    }
    
    // Parse type
    const typeMatch = directive.match(/type=(\w+)/i)
    if (typeMatch) {
      const typeValue = typeMatch[1].toLowerCase()
      if (typeValue === 'bar' || typeValue === 'bar_chart') config.type = 'bar'
      else if (typeValue === 'line' || typeValue === 'line_chart') config.type = 'line'
      else if (typeValue === 'pie' || typeValue === 'pie_chart') config.type = 'pie'
      else if (typeValue === 'grouped_bar' || typeValue === 'grouped') config.type = 'grouped_bar'
      else if (typeValue === 'stacked_bar' || typeValue === 'stacked') config.type = 'stacked_bar'
      else if (typeValue === 'grouped_line') config.type = 'grouped_line'
    }
    
    // Parse labels column
    const labelsMatch = directive.match(/labels=(\w+)/i)
    if (labelsMatch) config.labelColumn = labelsMatch[1]
    
    // Parse values column
    const valuesMatch = directive.match(/values=(\w+)/i)
    if (valuesMatch) config.valueColumn = valuesMatch[1]
    
    // Parse group column (for grouped charts)
    const groupMatch = directive.match(/group=(\w+)/i)
    if (groupMatch) config.groupColumn = groupMatch[1]
    
    // Parse orientation
    const orientMatch = directive.match(/orientation=(\w+)/i)
    if (orientMatch) {
      const orient = orientMatch[1].toLowerCase()
      if (orient === 'vertical' || orient === 'v') config.orientation = 'vertical'
      else if (orient === 'horizontal' || orient === 'h') config.orientation = 'horizontal'
    }
    
    // Parse style (2d or 3d)
    const styleMatch = directive.match(/style=(\w+)/i)
    if (styleMatch) {
      const style = styleMatch[1].toLowerCase()
      if (style === '3d' || style === 'three' || style === 'threejs') config.visualization = '3d'
      else config.visualization = '2d'
    }
    
    return Object.keys(config).length > 0 ? config : null
  }, [])

  const runQuery = useCallback(async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    setSortConfig(null)  // Reset sort when running new query
    
    const startTime = performance.now()
    
    // Check for chart directive before running
    const chartDirective = parseChartDirective(sql)
    
    try {
      const rows = await executeQuery<Record<string, unknown>>(sql)
      const endTime = performance.now()
      
      const columns = rows.length > 0 ? Object.keys(rows[0]) : []
      
      setResult({
        columns,
        rows,
        rowCount: rows.length,
        executionTime: endTime - startTime,
      })
      
      // If chart directive found, use it and switch to chart view
      if (chartDirective) {
        const numericCol = columns.find(col => 
          rows.some(r => isNumericValue(r[col]))
        )
        const labelCol = columns.find(col => col !== numericCol)
        
        const newChartConfig = {
          type: chartDirective.type || chartConfig.type,
          labelColumn: chartDirective.labelColumn || labelCol || columns[0],
          valueColumn: chartDirective.valueColumn || numericCol || columns[1],
          groupColumn: chartDirective.groupColumn,
          orientation: chartDirective.orientation,
          visualization: chartDirective.visualization || '2d',
          title: chartDirective.title,
          description: chartDirective.description,
        } as ChartConfig
        setChartConfig(newChartConfig)
        setViewMode('chart')
        syncUrlState(sql, 'chart', newChartConfig)
      } else {
        // Auto-select columns for chart if we have results
        setViewMode('table')
        if (columns.length >= 2) {
          const numericCol = columns.find(col => 
            rows.some(r => isNumericValue(r[col]))
          )
          const labelCol = columns.find(col => col !== numericCol)
          const newChartConfig = {
            ...chartConfig,
            labelColumn: labelCol || columns[0],
            valueColumn: numericCol || columns[1],
            title: undefined,
            description: undefined,
          }
          setChartConfig(newChartConfig)
        }
        syncUrlState(sql, 'table', chartConfig)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed')
    } finally {
      setLoading(false)
    }
  }, [sql, parseChartDirective, syncUrlState, chartConfig])

  const selectPreset = useCallback(async (preset: PresetQuery) => {
    setSql(preset.sql)
    setResult(null)
    setError(null)
    setSortConfig(null)  // Reset sort when selecting preset
    // Reset chart config when selecting a new preset
    setChartConfig({
      type: 'bar',
      labelColumn: '',
      valueColumn: '',
      groupColumn: undefined,
      orientation: undefined,
      visualization: '2d',
      title: undefined,
      description: undefined,
    })
    
    // Auto-run the query
    setLoading(true)
    const startTime = performance.now()
    
    // Check for chart directive
    const chartDirective = parseChartDirective(preset.sql)
    
    try {
      const rows = await executeQuery<Record<string, unknown>>(preset.sql)
      const endTime = performance.now()
      
      const columns = rows.length > 0 ? Object.keys(rows[0]) : []
      
      setResult({
        columns,
        rows,
        rowCount: rows.length,
        executionTime: endTime - startTime,
      })
      
      // If chart directive found, use it and switch to chart view
      if (chartDirective) {
        const numericCol = columns.find(col => 
          rows.some(r => isNumericValue(r[col]))
        )
        const labelCol = columns.find(col => col !== numericCol)
        
        const newChartConfig = {
          type: chartDirective.type || 'bar',
          labelColumn: chartDirective.labelColumn || labelCol || columns[0],
          valueColumn: chartDirective.valueColumn || numericCol || columns[1],
          groupColumn: chartDirective.groupColumn,
          orientation: chartDirective.orientation,
          visualization: chartDirective.visualization || '2d',
          title: chartDirective.title,
          description: chartDirective.description,
        } as ChartConfig
        setChartConfig(newChartConfig)
        setViewMode('chart')
        // Sync URL with preset
        syncUrlState(preset.sql, 'chart', newChartConfig)
      } else {
        // Auto-select columns for chart if we have results
        setViewMode('table')
        let newChartConfig = chartConfig
        if (columns.length >= 2) {
          const numericCol = columns.find(col => 
            rows.some(r => isNumericValue(r[col]))
          )
          const labelCol = columns.find(col => col !== numericCol)
          newChartConfig = {
            ...chartConfig,
            labelColumn: labelCol || columns[0],
            valueColumn: numericCol || columns[1],
            title: undefined,
            description: undefined,
          }
          setChartConfig(newChartConfig)
        }
        // Sync URL with preset index
        syncUrlState(preset.sql, 'table', newChartConfig)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed')
    } finally {
      setLoading(false)
    }
  }, [parseChartDirective, syncUrlState, chartConfig])

  // Auto-execute the first query when the component mounts
  useEffect(() => {
    if (!hasAutoExecuted.current) {
      hasAutoExecuted.current = true
      runQuery()
    }
  }, [runQuery])

  const showTableSchema = useCallback(async (table: string) => {
    // Toggle off if clicking same table
    if (tableSchema?.table === table && viewMode === 'schema') {
      setTableSchema(null)
      setViewMode('table')
      return
    }
    
    setSchemaLoading(true)
    setResult(null)
    setError(null)
    try {
      const rows = await executeQuery<{ column_name: string; column_type: string }>(
        `DESCRIBE SELECT * FROM ${parquet(table as keyof typeof TABLES)}`
      )
      
      // Get schema metadata for descriptions and PK/FK info
      const metadata = await fetchSchemaMetadata()
      const tableMetadata = metadata.tables[table]
      
      setTableSchema({
        table,
        description: tableMetadata?.description,
        columns: rows.map(r => {
          const colMeta = tableMetadata?.columns.find(c => c.name === r.column_name)
          return {
            name: r.column_name,
            type: r.column_type,
            description: colMeta?.description,
            pk: colMeta?.pk,
            fk: colMeta?.fk,
          }
        }),
      })
      setViewMode('schema')
    } catch (err) {
      console.error('Failed to get schema:', err)
      setTableSchema(null)
    } finally {
      setSchemaLoading(false)
    }
  }, [tableSchema, viewMode])

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return '—'
    if (Array.isArray(value)) return value.join(', ') || '—'
    if (typeof value === 'bigint') return value.toString()
    // Handle DuckDB aggregate objects like {"0": 7199}
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>
      const keys = Object.keys(obj)
      if (keys.length === 1 && /^\d+$/.test(keys[0])) {
        // Looks like a DuckDB aggregate result
        return String(obj[keys[0]])
      }
      return JSON.stringify(value)
    }
    return String(value)
  }

  // Compute chart data from results
  const chartData = useMemo(() => {
    if (!result || !chartConfig.labelColumn || !chartConfig.valueColumn) return []
    
    return result.rows.map((row, i) => ({
      label: formatValue(row[chartConfig.labelColumn]),
      value: extractNumericValue(row[chartConfig.valueColumn]),
      color: CHART_COLORS[i % CHART_COLORS.length],
    })).slice(0, 50) // Limit to 50 items for readability
  }, [result, chartConfig.labelColumn, chartConfig.valueColumn])

  // Compute grouped chart data for grouped_bar charts
  const groupedChartData = useMemo((): GroupedChartData[] => {
    if (!result || !chartConfig.labelColumn || !chartConfig.valueColumn || !chartConfig.groupColumn) return []
    
    // Group rows by label
    const grouped = new Map<string, Map<string, number>>()
    
    for (const row of result.rows) {
      const label = formatValue(row[chartConfig.labelColumn])
      const group = formatValue(row[chartConfig.groupColumn])
      const value = extractNumericValue(row[chartConfig.valueColumn])
      
      if (!grouped.has(label)) {
        grouped.set(label, new Map())
      }
      grouped.get(label)!.set(group, value)
    }
    
    // Get all unique group names
    const allGroupsRaw = [...new Set(result.rows.map(r => formatValue(r[chartConfig.groupColumn!])))]
    
    // Check if these are stage groups (alpha/beta/stable) - if so, sort them
    const stageOrder: Record<string, number> = { 'alpha': 0, 'beta': 1, 'stable': 2 }
    const isStageGroups = allGroupsRaw.every(g => stageOrder[g.toLowerCase()] !== undefined)
    
    const allGroups = isStageGroups 
      ? allGroupsRaw.sort((a, b) => stageOrder[a.toLowerCase()] - stageOrder[b.toLowerCase()])
      : allGroupsRaw // Keep original order for non-stage groups
    
    // Convert to array format
    return Array.from(grouped.entries()).map(([label, groups]) => ({
      label,
      groups: allGroups.map((groupName, i) => ({
        name: groupName,
        value: groups.get(groupName) || 0,
        color: STAGE_COLORS[groupName] || CHART_COLORS[i % CHART_COLORS.length],
      })),
    })).slice(0, 30) // Limit for readability
  }, [result, chartConfig.labelColumn, chartConfig.valueColumn, chartConfig.groupColumn])

  // Check if we can show charts (need at least one numeric column)
  const canShowChart = useMemo(() => {
    if (!result || result.rows.length === 0) return false
    return result.columns.some(col => 
      result.rows.some(r => isNumericValue(r[col]))
    )
  }, [result])

  // Handle column header click for sorting
  const handleSort = useCallback((column: string) => {
    setSortConfig(prev => {
      if (prev?.column === column) {
        // Toggle direction or clear if already desc
        if (prev.direction === 'asc') return { column, direction: 'desc' }
        return null // Clear sort on third click
      }
      return { column, direction: 'asc' }
    })
  }, [])

  // Sorted rows
  const sortedRows = useMemo(() => {
    if (!result || !sortConfig) return result?.rows || []
    
    const { column, direction } = sortConfig
    return [...result.rows].sort((a, b) => {
      const aVal = a[column]
      const bVal = b[column]
      
      // Handle nulls
      if (aVal === null || aVal === undefined) return direction === 'asc' ? 1 : -1
      if (bVal === null || bVal === undefined) return direction === 'asc' ? -1 : 1
      
      // Numeric comparison
      if (isNumericValue(aVal) && isNumericValue(bVal)) {
        const aNum = extractNumericValue(aVal)
        const bNum = extractNumericValue(bVal)
        return direction === 'asc' ? aNum - bNum : bNum - aNum
      }
      
      // String comparison
      const aStr = String(aVal).toLowerCase()
      const bStr = String(bVal).toLowerCase()
      if (aStr < bStr) return direction === 'asc' ? -1 : 1
      if (aStr > bStr) return direction === 'asc' ? 1 : -1
      return 0
    })
  }, [result, sortConfig])

  // Copy results to clipboard as TSV (tab-separated, easy to paste into spreadsheets)
  const copyToClipboard = useCallback(async () => {
    if (!result || result.rows.length === 0) return
    
    const header = result.columns.join('\t')
    const rows = result.rows.map(row => 
      result.columns.map(col => formatValue(row[col])).join('\t')
    )
    const tsv = [header, ...rows].join('\n')
    
    try {
      await navigator.clipboard.writeText(tsv)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [result])

  return (
    <div className={styles.container}>
      <div className={`${styles.sidebar} ${sidebarCollapsed ? styles.sidebarCollapsed : ''}`}>
        {sidebarCollapsed ? (
          <button 
            className={styles.sidebarToggle}
            onClick={() => setSidebarCollapsed(false)}
            title="Expand sidebar"
          >
            ›
          </button>
        ) : (
          <>
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>Preset Queries</h3>
            {PRESET_QUERIES.length > MAX_SIDEBAR_QUERIES && (
              <button
                className={styles.showAllButton}
                onClick={() => {
                  setResult(null)
                  setTableSchema(null)
                  setViewMode('queries')
                }}
                title="Show all queries"
              >
                All ({PRESET_QUERIES.length})
              </button>
            )}
            <button 
              className={styles.sidebarToggle}
              onClick={() => setSidebarCollapsed(true)}
              title="Collapse sidebar"
            >
              ‹
            </button>
          </div>
          <div className={styles.presetList}>
            {PRESET_QUERIES.slice(0, MAX_SIDEBAR_QUERIES).map((preset, i) => (
              <button
                key={i}
                className={styles.presetButton}
                onClick={() => selectPreset(preset)}
              >
                <span className={styles.presetName}>{preset.name}</span>
                <span className={styles.presetDesc}>{preset.description}</span>
              </button>
            ))}
          </div>
        </div>
        
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>Available Tables</h3>
            <button
              className={styles.schemaOverviewButton}
              onClick={() => {
                setTableSchema(null)
                setViewMode('schema')
                setResult(null)
              }}
              title="View all tables"
            >
              ◫
            </button>
          </div>
          <div className={styles.tableList}>
            {Object.keys(TABLES).sort().map(table => {
              const displayName = `${table}.parquet`
              const truncatedName = displayName.length > 26 ? displayName.slice(0, 23) + '...' : displayName
              return (
                <div key={table} className={styles.tableRow}>
                  <button
                    className={`${styles.tableButton} ${tableSchema?.table === table ? styles.tableButtonActive : ''}`}
                    onClick={() => showTableSchema(table)}
                    disabled={schemaLoading}
                    title={displayName}
                  >
                    {truncatedName}
                  </button>
                  <button
                    className={styles.previewButton}
                    onClick={async () => {
                      setTableSchema(null)
                      const previewSql = `SELECT * FROM '${table}.parquet' LIMIT 100`
                      setSql(previewSql)
                      setLoading(true)
                      setError(null)
                      setResult(null)
                      const startTime = performance.now()
                      try {
                        const rows = await executeQuery<Record<string, unknown>>(previewSql)
                        const endTime = performance.now()
                        const columns = rows.length > 0 ? Object.keys(rows[0]) : []
                        setResult({
                          columns,
                          rows,
                          rowCount: rows.length,
                          executionTime: endTime - startTime,
                        })
                        setViewMode('table')
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Query failed')
                      } finally {
                        setLoading(false)
                      }
                    }}
                    title={`Preview ${table}`}
                    disabled={loading}
                  >
                    ▶
                  </button>
                </div>
              )
            })}
          </div>
        </div>
          </>
        )}
      </div>
      
      <div className={styles.main}>
        <div className={styles.editor} style={{ height: editorHeight }}>
          <div className={styles.editorHeader}>
            <span className={styles.editorTitle}>SQL Query</span>
            <div className={styles.runButtonGroup}>
              <span className={styles.shortcutHint}>⌘/Ctrl + Enter</span>
              <button 
                className={styles.runButton}
                onClick={runQuery}
                disabled={loading || !sql.trim()}
              >
                {loading ? 'Running...' : '▶ Run Query'}
              </button>
            </div>
          </div>
          <div className={styles.sqlEditorContainer}>
            <pre ref={highlightRef} className={styles.sqlHighlight} aria-hidden="true">
              <code dangerouslySetInnerHTML={{ __html: highlightSQL(sql) + '\n' }} />
            </pre>
            <textarea
              ref={textareaRef}
              className={styles.sqlInput}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onScroll={handleTextareaScroll}
              onKeyDown={(e) => {
                // Cmd/Ctrl + Enter to run query
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  if (!loading && sql.trim()) {
                    runQuery()
                  }
                }
              }}
              placeholder="Enter SQL query..."
              spellCheck={false}
            />
          </div>
        </div>
        
        <div 
          className={styles.resizer}
          onMouseDown={handleResizerMouseDown}
          title="Drag to resize"
        />
        
        <div className={styles.results}>
          {error && (
            <div className={styles.error}>
              <span className={styles.errorIcon}>⚠</span>
              <span>{error}</span>
            </div>
          )}
          
          {/* Schema View */}
          {viewMode === 'schema' && (
            <div className={styles.schemaView}>
              <div className={styles.schemaViewContent}>
                {/* ER Diagram */}
                <div className={styles.erDiagramContainer}>
                  <ERDiagram 
                    selectedTable={tableSchema?.table || null}
                    tableSchema={tableSchema}
                    schemaMetadata={schemaMetadata}
                    onSelectTable={showTableSchema}
                  />
                </div>
              </div>
            </div>
          )}
          
          {/* All Queries Grid View */}
          {viewMode === 'queries' && (
            <div className={styles.queriesView}>
              <div className={styles.querySearchContainer}>
                <input
                  type="text"
                  className={styles.querySearchInput}
                  placeholder="Search queries..."
                  value={querySearch}
                  onChange={(e) => setQuerySearch(e.target.value)}
                  autoFocus
                />
                {querySearch && (
                  <button
                    className={styles.querySearchClear}
                    onClick={() => setQuerySearch('')}
                    title="Clear search"
                  >
                    ×
                  </button>
                )}
              </div>
              {(Object.keys(PRESET_QUERY_GROUPS) as Array<PresetQuery['group']>).map(groupKey => {
                const searchLower = querySearch.toLowerCase()
                const groupQueries = PRESET_QUERIES.filter(q => 
                  q.group === groupKey && 
                  (!querySearch || 
                    q.name.toLowerCase().includes(searchLower) || 
                    q.description.toLowerCase().includes(searchLower))
                )
                if (groupQueries.length === 0) return null
                const groupInfo = PRESET_QUERY_GROUPS[groupKey]
                return (
                  <div key={groupKey} className={styles.queryGroup}>
                    <h3 className={styles.queryGroupTitle} style={{ borderBottomColor: `${groupInfo.color}40` }}>
                      <span className={styles.queryGroupDot} style={{ background: groupInfo.color }} />
                      {groupInfo.label}
                    </h3>
                    <div className={styles.queryGrid}>
                      {groupQueries.map((preset, i) => (
                        <button
                          key={i}
                          className={styles.queryCard}
                          onClick={() => {
                            selectPreset(preset)
                            setQuerySearch('')
                            setViewMode('table')
                          }}
                        >
                          {preset.chartType && (
                            <span className={styles.queryCardChartBadge}>
                              {CHART_TYPE_LABELS[preset.chartType] || preset.chartType}
                              {preset.chartStyle && <span className={styles.queryCardChartStyle}>{preset.chartStyle.toUpperCase()}</span>}
                            </span>
                          )}
                          <span className={styles.queryCardName}>{preset.name}</span>
                          <span className={styles.queryCardDesc}>{preset.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
              {querySearch && PRESET_QUERIES.filter(q => 
                q.name.toLowerCase().includes(querySearch.toLowerCase()) || 
                q.description.toLowerCase().includes(querySearch.toLowerCase())
              ).length === 0 && (
                <div className={styles.queryNoResults}>
                  No queries match "{querySearch}"
                </div>
              )}
            </div>
          )}
          
          {result && viewMode !== 'schema' && (
            <div className={styles.resultsContent}>
              <div className={styles.resultsMeta}>
                <div className={styles.resultsInfo}>
                  <span>{result.rowCount} rows</span>
                  <span className={styles.execTime}>
                    {result.executionTime.toFixed(1)}ms
                  </span>
                  <button
                    className={styles.copyButton}
                    onClick={copyToClipboard}
                    title="Copy results as TSV"
                  >
                    {copied ? '✓' : '⧉'}
                  </button>
                </div>
                
                {canShowChart && result.rows.length > 0 && (
                  <div className={styles.viewToggle}>
                    <button
                      className={`${styles.viewButton} ${viewMode === 'table' ? styles.viewButtonActive : ''}`}
                      onClick={() => handleViewModeChange('table')}
                    >
                      Table
                    </button>
                    <button
                      className={`${styles.viewButton} ${viewMode === 'chart' ? styles.viewButtonActive : ''}`}
                      onClick={() => handleViewModeChange('chart')}
                    >
                      Chart
                    </button>
                  </div>
                )}
              </div>
              
              <div className={styles.resultsBody}>
                {result.rows.length > 0 ? (
                  viewMode === 'table' ? (
                    <div className={styles.tableWrapper}>
                      <table className={styles.resultsTable}>
                        <thead>
                          <tr>
                            {result.columns.map(col => (
                              <th 
                                key={col} 
                                onClick={() => handleSort(col)}
                                className={styles.sortableHeader}
                              >
                                {col}
                                {sortConfig?.column === col && (
                                  <span className={styles.sortIndicator}>
                                    {sortConfig.direction === 'asc' ? ' ↑' : ' ↓'}
                                  </span>
                                )}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sortedRows.map((row, i) => (
                            <tr key={i}>
                              {result.columns.map(col => (
                                <td key={col}>{formatValue(row[col])}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className={styles.chartWrapper}>
                      <div className={styles.chartControls}>
                        <div className={styles.chartControl}>
                          <label>Chart Type</label>
                          <select
                            value={chartConfig.type}
                            onChange={(e) => setChartConfig(prev => ({ ...prev, type: e.target.value as ChartType }))}
                          >
                            <option value="bar">Bar Chart</option>
                            <option value="line">Line Chart</option>
                            <option value="pie">Pie Chart</option>
                            {chartConfig.type === 'grouped_bar' && <option value="grouped_bar">Grouped Bar</option>}
                            {chartConfig.type === 'stacked_bar' && <option value="stacked_bar">Stacked Bar</option>}
                            {chartConfig.type === 'grouped_line' && <option value="grouped_line">Grouped Line</option>}
                          </select>
                        </div>
                        <div className={styles.chartControl}>
                          <label>Labels</label>
                          <select
                            value={chartConfig.labelColumn}
                            onChange={(e) => setChartConfig(prev => ({ ...prev, labelColumn: e.target.value }))}
                          >
                            {result.columns.map(col => (
                              <option key={col} value={col}>{col}</option>
                            ))}
                          </select>
                        </div>
                        <div className={styles.chartControl}>
                          <label>Values</label>
                          <select
                            value={chartConfig.valueColumn}
                            onChange={(e) => setChartConfig(prev => ({ ...prev, valueColumn: e.target.value }))}
                          >
                            {result.columns.map(col => (
                              <option key={col} value={col}>{col}</option>
                            ))}
                          </select>
                        </div>
                        {/* Show Group selector only for grouped_bar, stacked_bar, and grouped_line */}
                        {(chartConfig.type === 'grouped_bar' || chartConfig.type === 'stacked_bar' || chartConfig.type === 'grouped_line') && chartConfig.groupColumn && (
                          <div className={styles.chartControl}>
                            <label>Group</label>
                            <select
                              value={chartConfig.groupColumn}
                              onChange={(e) => setChartConfig(prev => ({ ...prev, groupColumn: e.target.value }))}
                            >
                              {result.columns.map(col => (
                                <option key={col} value={col}>{col}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        {/* Show Orientation selector only for grouped_bar and stacked_bar */}
                        {(chartConfig.type === 'grouped_bar' || chartConfig.type === 'stacked_bar') && (
                          <div className={styles.chartControl}>
                            <label>Orient</label>
                            <select
                              value={chartConfig.orientation || 'horizontal'}
                              onChange={(e) => setChartConfig(prev => ({ ...prev, orientation: e.target.value as 'horizontal' | 'vertical' }))}
                            >
                              <option value="horizontal">Horizontal</option>
                              <option value="vertical">Vertical</option>
                            </select>
                          </div>
                        )}
                        {/* Style selector (2D/3D) */}
                        <div className={styles.chartControl}>
                          <label>Style</label>
                          <select
                            value={chartConfig.visualization}
                            onChange={(e) => setChartConfig(prev => ({ ...prev, visualization: e.target.value as Visualization }))}
                          >
                            <option value="2d">2D</option>
                            <option value="3d">3D</option>
                          </select>
                        </div>
                      </div>
                      
                      {/* Title/description for 2D charts (3D charts have it built-in) */}
                      {chartConfig.visualization === '2d' && (chartConfig.title || chartConfig.description) && (
                        <div className={styles.chart2dHeader}>
                          {chartConfig.title && <div className={styles.chart2dTitle}>{chartConfig.title}</div>}
                          {chartConfig.description && <div className={styles.chart2dDescription}>{chartConfig.description}</div>}
                        </div>
                      )}
                      
                      <div className={`${styles.chartArea} ${chartConfig.visualization === '3d' ? styles.chartArea3d : ''}`}>
                        {chartConfig.visualization === '2d' ? (
                          <>
                            {chartConfig.type === 'bar' && <BarChart data={chartData} />}
                            {chartConfig.type === 'line' && <LineChart data={chartData} />}
                            {chartConfig.type === 'pie' && <PieChart data={chartData} />}
                            {chartConfig.type === 'grouped_bar' && <GroupedBarChart data={groupedChartData} orientation={chartConfig.orientation} />}
                            {chartConfig.type === 'stacked_bar' && <StackedBarChart data={groupedChartData} orientation={chartConfig.orientation} />}
                            {chartConfig.type === 'grouped_line' && <GroupedLineChart data={groupedChartData} />}
                          </>
                        ) : (
                          <>
                            {chartConfig.type === 'bar' && <BarChart3D data={chartData} title={chartConfig.title} description={chartConfig.description} initialFullscreen={isChartFullscreen} onFullscreenChange={handleChartFullscreenChange} />}
                            {chartConfig.type === 'line' && <LineChart3D data={chartData} title={chartConfig.title} description={chartConfig.description} initialFullscreen={isChartFullscreen} onFullscreenChange={handleChartFullscreenChange} />}
                            {chartConfig.type === 'pie' && <PieChart3D data={chartData} title={chartConfig.title} description={chartConfig.description} initialFullscreen={isChartFullscreen} onFullscreenChange={handleChartFullscreenChange} />}
                            {chartConfig.type === 'grouped_bar' && <GroupedBarChart3D data={groupedChartData} orientation={chartConfig.orientation} title={chartConfig.title} description={chartConfig.description} initialFullscreen={isChartFullscreen} onFullscreenChange={handleChartFullscreenChange} />}
                            {chartConfig.type === 'stacked_bar' && <StackedBarChart3D data={groupedChartData} orientation={chartConfig.orientation} title={chartConfig.title} description={chartConfig.description} initialFullscreen={isChartFullscreen} onFullscreenChange={handleChartFullscreenChange} />}
                            {chartConfig.type === 'grouped_line' && <GroupedLineChart3D data={groupedChartData} title={chartConfig.title} description={chartConfig.description} initialFullscreen={isChartFullscreen} onFullscreenChange={handleChartFullscreenChange} />}
                          </>
                        )}
                      </div>
                    </div>
                  )
                ) : (
                  <div className={styles.noResults}>No results</div>
                )}
              </div>
            </div>
          )}
          
          {!result && !error && !loading && viewMode !== 'schema' && (
            <div className={styles.placeholder}>
              <p>Select a preset query or write your own SQL</p>
              <p className={styles.hint}>
                Use <code>'{`{table}`}.parquet'</code> to reference tables
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
