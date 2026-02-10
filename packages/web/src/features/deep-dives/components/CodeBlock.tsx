/**
 * CodeBlock Component
 *
 * Syntax-highlighted code block for displaying code snippets.
 *
 * @module features/deep-dives/components/CodeBlock
 */

import { useCallback, useState } from 'react'
import styles from './CodeBlock.module.css'

// =============================================================================
// Types
// =============================================================================

interface CodeBlockProps {
  /** Code content */
  code: string
  /** Language for syntax highlighting hint */
  language?: 'yaml' | 'json' | 'bash' | 'go' | 'text'
  /** Title/filename to display */
  title?: string
  /** Show line numbers (default: true for multi-line) */
  showLineNumbers?: boolean
  /** Show copy button (default: true) */
  showCopy?: boolean
  /** Highlight specific lines (1-indexed) */
  highlightLines?: number[]
  /** Custom class name */
  className?: string
}

// =============================================================================
// Syntax Highlighting (Simple)
// =============================================================================

function highlightSyntax(code: string, language: string): string {
  // Simple keyword highlighting - in production, use a proper library like Prism
  let highlighted = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  switch (language) {
    case 'yaml':
      // Keys
      highlighted = highlighted.replace(
        /^(\s*)([a-zA-Z_][a-zA-Z0-9_-]*):/gm,
        '$1<span class="key">$2</span>:'
      )
      // Strings
      highlighted = highlighted.replace(
        /: "([^"]*)"/g,
        ': <span class="string">"$1"</span>'
      )
      highlighted = highlighted.replace(
        /: '([^']*)'/g,
        ": <span class=\"string\">'$1'</span>"
      )
      // Comments
      highlighted = highlighted.replace(
        /(#.*)$/gm,
        '<span class="comment">$1</span>'
      )
      // Numbers
      highlighted = highlighted.replace(
        /: (\d+)$/gm,
        ': <span class="number">$1</span>'
      )
      // Booleans
      highlighted = highlighted.replace(
        /: (true|false)$/gm,
        ': <span class="boolean">$1</span>'
      )
      break

    case 'json':
      // Keys
      highlighted = highlighted.replace(
        /"([^"]+)":/g,
        '<span class="key">"$1"</span>:'
      )
      // Strings
      highlighted = highlighted.replace(
        /: "([^"]*)"/g,
        ': <span class="string">"$1"</span>'
      )
      // Numbers
      highlighted = highlighted.replace(
        /: (\d+)/g,
        ': <span class="number">$1</span>'
      )
      // Booleans
      highlighted = highlighted.replace(
        /: (true|false)/g,
        ': <span class="boolean">$1</span>'
      )
      break

    case 'bash':
      // Comments
      highlighted = highlighted.replace(
        /(#.*)$/gm,
        '<span class="comment">$1</span>'
      )
      // Commands
      highlighted = highlighted.replace(
        /^(\s*)(kubectl|docker|helm|kubeadm|kubelet)/gm,
        '$1<span class="keyword">$2</span>'
      )
      // Flags
      highlighted = highlighted.replace(
        /(\s)(--?[a-zA-Z0-9-]+)/g,
        '$1<span class="flag">$2</span>'
      )
      break

    case 'go':
      // Keywords
      const goKeywords = ['func', 'type', 'struct', 'interface', 'package', 'import', 'return', 'if', 'else', 'for', 'range', 'var', 'const']
      for (const kw of goKeywords) {
        highlighted = highlighted.replace(
          new RegExp(`\\b(${kw})\\b`, 'g'),
          '<span class="keyword">$1</span>'
        )
      }
      // Comments
      highlighted = highlighted.replace(
        /(\/\/.*)$/gm,
        '<span class="comment">$1</span>'
      )
      // Strings
      highlighted = highlighted.replace(
        /"([^"]*)"/g,
        '<span class="string">"$1"</span>'
      )
      break
  }

  return highlighted
}

// =============================================================================
// Component
// =============================================================================

export function CodeBlock({
  code,
  language = 'text',
  title,
  showLineNumbers,
  showCopy = true,
  highlightLines = [],
  className = '',
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const lines = code.split('\n')
  const shouldShowLineNumbers = showLineNumbers ?? lines.length > 1

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [code])

  const highlightedCode = highlightSyntax(code, language)

  return (
    <div className={`${styles.codeBlock} ${className}`}>
      {(title || showCopy) && (
        <div className={styles.header}>
          {title && <span className={styles.title}>{title}</span>}
          {showCopy && (
            <button
              className={styles.copyButton}
              onClick={handleCopy}
              title="Copy to clipboard"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          )}
        </div>
      )}

      <div className={styles.codeContainer}>
        {shouldShowLineNumbers && (
          <div className={styles.lineNumbers}>
            {lines.map((_, i) => (
              <span
                key={i}
                className={`${styles.lineNumber} ${highlightLines.includes(i + 1) ? styles.highlighted : ''}`}
              >
                {i + 1}
              </span>
            ))}
          </div>
        )}

        <pre className={styles.pre}>
          <code
            className={`${styles.code} ${styles[language]}`}
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
          />
        </pre>
      </div>
    </div>
  )
}

// =============================================================================
// Inline Code Component
// =============================================================================

interface InlineCodeProps {
  children: React.ReactNode
  className?: string
}

export function InlineCode({ children, className = '' }: InlineCodeProps) {
  return <code className={`${styles.inlineCode} ${className}`}>{children}</code>
}

export default CodeBlock
