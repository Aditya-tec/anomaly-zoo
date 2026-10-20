package txn

import "github.com/Aditya-tec/anomaly-zoo/engine/trace"

// Hook is what an SSI callback returns: effects to record and whether the
// transaction executing the statement must abort now.
type Hook struct {
	AbortSelf bool
	Effects   []trace.Effect
}

// SSI is the serializable-snapshot-isolation tracker (package ssi). It is only
// called at level SER.
type SSI interface {
	OnRead(m *Manager, t *Txn, key string) Hook
	OnScan(m *Manager, t *Txn, prefix string) Hook
	OnWrite(m *Manager, t *Txn, key string) Hook
	DangerousAtCommit(m *Manager, t *Txn) bool
	AfterCommit(m *Manager, t *Txn) []trace.Effect
	OnAbort(m *Manager, t *Txn)
}

// NopSSI does nothing; it is used at RU, RC and SI.
type NopSSI struct{}

func (NopSSI) OnRead(*Manager, *Txn, string) Hook  { return Hook{} }
func (NopSSI) OnScan(*Manager, *Txn, string) Hook  { return Hook{} }
func (NopSSI) OnWrite(*Manager, *Txn, string) Hook { return Hook{} }
func (NopSSI) DangerousAtCommit(*Manager, *Txn) bool {
	return false
}
func (NopSSI) AfterCommit(*Manager, *Txn) []trace.Effect { return nil }
func (NopSSI) OnAbort(*Manager, *Txn)                    {}
