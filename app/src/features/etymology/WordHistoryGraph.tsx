import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { type EtymologyData, RELATIONSHIP_COLORS, type WordTrail } from '../../domain/etymology'
import { layoutTrail } from './trailLayout'

interface Props {
  readonly data: EtymologyData
  readonly trail: WordTrail
  readonly root: string
  readonly selected: string
  readonly edgeId: string | null
  readonly onWord: (id: string) => void
  readonly onEdge: (id: string) => void
}
const short = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text

export const WordHistoryGraph = ({
  data,
  trail,
  root,
  selected,
  edgeId,
  onWord,
  onEdge,
}: Props) => {
  const layout = useMemo(() => layoutTrail(trail), [trail])
  const markerId = useId().replace(/:/g, '')
  const container = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null)
  const [size, setSize] = useState({ width: 800, height: 460 })
  const [camera, setCamera] = useState({ x: 0, y: 0, k: 1 })
  useEffect(() => {
    if (!container.current) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
      }
    })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  const base = Math.min(1, (size.width - 30) / layout.width, (size.height - 65) / layout.height)
  const scale = base * camera.k
  const x = (size.width - layout.width * scale) / 2 + camera.x
  const y = (size.height - layout.height * scale) / 2 + camera.y
  const zoom = (factor: number) =>
    setCamera((current) => ({ ...current, k: Math.max(0.3, Math.min(6, current.k * factor)) }))
  return (
    <div className="word-graph" ref={container}>
      {/* biome-ignore lint/a11y/useSemanticElements: SVG groups preserve interactive vector geometry; HTML fieldsets cannot replace them. */}
      <svg
        viewBox={`0 0 ${size.width} ${size.height}`}
        role="group"
        aria-label={`Recorded word history, ${trail.ids.length} forms and ${trail.edges.length} relationships. Select a form or connection to inspect its evidence.`}
        onPointerDown={(event) => {
          if ((event.target as Element).closest('[role="button"]')) return
          drag.current = { x: event.clientX, y: event.clientY, startX: camera.x, startY: camera.y }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!drag.current) return
          setCamera({
            ...camera,
            x: drag.current.startX + event.clientX - drag.current.x,
            y: drag.current.startY + event.clientY - drag.current.y,
          })
        }}
        onPointerUp={() => {
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
      >
        <title>Source → later or derived form. Spacing represents recorded steps, not years.</title>
        <defs>
          {Object.entries(RELATIONSHIP_COLORS).map(([type, color]) => (
            <marker
              key={type}
              id={`${markerId}-${type}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke={color} strokeWidth="1.4" />
            </marker>
          ))}
        </defs>
        <g transform={`translate(${x},${y}) scale(${scale})`}>
          {trail.edges.map((edge) => {
            const a = layout.points.get(edge.p)
            const b = layout.points.get(edge.c)
            if (!a || !b) return null
            const x1 = a.x + 175,
              y1 = a.y + 34,
              x2 = b.x - 4,
              y2 = b.y + 34,
              mid = (x1 + x2) / 2
            const path =
              edge.p === edge.c
                ? `M${a.x + 130},${a.y} C${a.x + 175},${a.y - 45} ${a.x},${a.y - 45} ${a.x + 40},${a.y}`
                : x2 > x1
                  ? `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`
                  : `M${a.x + 87},${a.y + 68} C${a.x + 87},${a.y + 115} ${b.x + 87},${b.y - 40} ${b.x + 87},${b.y}`
            const label = `${data.types[edge.t]}: ${data.lexemes[edge.p]?.f} → ${data.lexemes[edge.c]?.f}`
            return (
              <g key={edge.id}>
                <path
                  d={path}
                  fill="none"
                  stroke={RELATIONSHIP_COLORS[edge.t] ?? RELATIONSHIP_COLORS[0]}
                  strokeWidth={edgeId === edge.id ? 4 : 2}
                  strokeDasharray={
                    edge.t === 1 || edge.t === 4 || edge.t === 32 ? undefined : '5 5'
                  }
                  markerEnd={`url(#${markerId}-${edge.t})`}
                />
                {/* biome-ignore lint/a11y/useSemanticElements: SVG path is a keyboard-accessible hit target; an HTML button is invalid here. */}
                <path
                  d={path}
                  className="word-edge-hit"
                  role="button"
                  tabIndex={0}
                  aria-label={label}
                  onClick={() => onEdge(edge.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onEdge(edge.id)
                    }
                  }}
                >
                  <title>{label}</title>
                </path>
              </g>
            )
          })}
          {trail.ids.map((id) => {
            const word = data.lexemes[id],
              point = layout.points.get(id)
            if (!word || !point) return null
            const language = data.languages[word.l]
            const label = `${word.f} · ${language?.name}${word.stub ? ' · Placeholder' : ''}`
            return (
              // biome-ignore lint/a11y/useSemanticElements: SVG node is keyboard-accessible; an HTML button cannot replace vector geometry.
              <g
                key={id}
                transform={`translate(${point.x},${point.y})`}
                role="button"
                tabIndex={0}
                className={`word-node${selected === id && !edgeId ? ' is-selected' : ''}${root === id ? ' is-root' : ''}${word.stub ? ' is-placeholder' : ''}`}
                aria-label={label}
                onClick={() => onWord(id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onWord(id)
                  }
                }}
              >
                <title>
                  {label} · {word.m || 'Meaning not recorded'} · #{id}
                </title>
                <rect width="175" height="68" rx="9" />
                <text x="13" y="29" className="word-node__form">
                  {short(word.f, 18)}
                </text>
                <text x="13" y="50" className="word-node__language">
                  {short(language?.name ?? '', 24)}
                  {word.stub ? ' ◇' : ''}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
      <div className="word-graph-tools">
        <button type="button" aria-label="Zoom out of word history" onClick={() => zoom(0.8)}>
          −
        </button>
        <button type="button" onClick={() => setCamera({ x: 0, y: 0, k: 1 })}>
          Fit view
        </button>
        <button type="button" aria-label="Zoom into word history" onClick={() => zoom(1.25)}>
          +
        </button>
      </div>
      <p className="word-graph-direction">
        Source → later / derived form{layout.cyclic ? ' · Cyclic records present' : ''}
      </p>
    </div>
  )
}
