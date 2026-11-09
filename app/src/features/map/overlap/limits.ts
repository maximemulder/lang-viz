// Shared-topology LODs retain detailed coverage boundaries; complete Asher views
// can exceed 300k positions. Keep worker output and receiver retention under the
// same finite bound while the integrated geometry pipeline is being evaluated.
export const MAX_COVERAGE_VERTICES = 600_000
