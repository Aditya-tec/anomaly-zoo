package trace

// Reason codes (spec §5.7). Stable ids used by the UI.
const (
	VisibleOwnWrite         = "visible_own_write"
	VisibleCommittedStmt    = "visible_committed_at_statement"
	VisibleCommittedSnap    = "visible_committed_before_snapshot"
	VisibleDirty            = "visible_dirty"
	InvisibleNewerSnapshot  = "invisible_newer_than_snapshot"
	InvisibleUncommittedOth = "invisible_uncommitted_other"
	Absent                  = "absent"
	LockAcquired            = "lock_acquired"
	BlockedOnLock           = "blocked_on_lock"
	LockGrantedAfterWait    = "lock_granted_after_wait"
	RWEdgeAdded             = "rw_edge_added"
	AbortConcurrentUpdate   = "abort_concurrent_update"
	AbortDependencies       = "abort_dependencies"
	AbortDeadlock           = "abort_deadlock"
	AbortUser               = "abort_user"
	AbortRuntimeError       = "abort_runtime_error"
	SkippedTxnAborted       = "skipped_txn_aborted"
	BlockedAtEnd            = "blocked_at_end"
)

// AllReasons lists every code (used by the schema and tests).
var AllReasons = []string{
	VisibleOwnWrite, VisibleCommittedStmt, VisibleCommittedSnap, VisibleDirty,
	InvisibleNewerSnapshot, InvisibleUncommittedOth, Absent, LockAcquired,
	BlockedOnLock, LockGrantedAfterWait, RWEdgeAdded, AbortConcurrentUpdate,
	AbortDependencies, AbortDeadlock, AbortUser, AbortRuntimeError,
	SkippedTxnAborted, BlockedAtEnd,
}
