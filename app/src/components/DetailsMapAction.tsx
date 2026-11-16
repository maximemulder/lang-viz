import './detailsMapAction.css'

/** Map actions belong in the detail body, below its identity header. */
export const DetailsMapAction = ({
  disabled,
  onFocus,
}: {
  readonly disabled: boolean
  readonly onFocus: () => void
}) => (
  <div className="details-map-action">
    <button
      type="button"
      className="details-map-action__button"
      disabled={disabled}
      onClick={onFocus}
    >
      Focus on map
    </button>
  </div>
)
