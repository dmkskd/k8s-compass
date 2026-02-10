# UI Patterns

## Component Organization

- `components/` - Reusable UI pieces (Header, Sidebar, DetailPanel, SpecStructure)
- `visualizations/` - Main view components (ConstellationView, SunburstView, ReleasesView)

## Styling

- **CSS Modules**: Each component has `.module.css` file
- **CSS Variables**: Defined in `styles/variables.css`, use `var(--color-*)`, `var(--space-*)`
- **Dark theme**: Default and only theme, space/constellation aesthetic
- **Colors**: Indigo/purple primary (`#6366f1`), group-specific colors in config

## Key Components

### DetailPanel
- Global overlay panel for Kind details
- Shows: description, scope, field count, short names, relationships, docs link
- Appears when `selectedKind` is set and `detailPanelOpen` is true
- Only shows in Releases view (API Explorer uses SpecStructure instead)

### SpecStructure  
- Full schema browser with field tree
- Shows in API Explorer (sunburst mode) as overlay
- Includes: docs link, scope badge, relationships, searchable field tree
- Has flat view and tree view modes

### Header
- Two-level navigation:
  1. Main tabs (API Explorer | Releases) - fixed, no wobble
  2. Sub-nav bar - context-dependent (view modes, search, version selector)

## State Patterns

```typescript
// Selecting a Kind opens detail panel
setSelectedKind(kind)  // Also sets detailPanelOpen: true

// Switching sections
setActiveSection('releases')  // Keeps selectedKind if set

// Version changes reset selections
setSelectedVersion(version)  // Clears selectedKind
```

## Animation Guidelines

- Subtle transitions (0.2-0.3s ease)
- Hover effects: slight lift (`translateY(-2px)`), glow shadows
- No jarring movements - maintain "calm flow" aesthetic
- Constellation: gentle rotation animation on dependency overlay

## Accessibility

- All interactive elements are buttons or links
- Title attributes for icon-only buttons
- Keyboard navigation (ESC to close panels)
