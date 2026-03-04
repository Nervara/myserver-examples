// main.go
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"runtime/debug"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ── Global pool ───────────────────────────────────────────────────────────────

var pool *pgxpool.Pool

// ── Request / response types ──────────────────────────────────────────────────

type TenantRequest struct {
	Name   string         `json:"name"`
	Config map[string]any `json:"config"`
}

type TenantResponse struct {
	TenantID  string         `json:"tenant_id"`
	Name      string         `json:"name"`
	Config    map[string]any `json:"config"`
	CreatedAt time.Time      `json:"created_at"`
}

type FacilityRequest struct {
	TenantID string   `json:"tenant_id"`
	Lat      float64  `json:"latitude"`
	Lon      float64  `json:"longitude"`
	Features []string `json:"features"`
}

type FacilityResponse struct {
	FacilityID int64    `json:"facility_id"`
	TenantID   string   `json:"tenant_id"`
	Latitude   float64  `json:"latitude"`
	Longitude  float64  `json:"longitude"`
	Features   []string `json:"features"`
}

type AssetRequest struct {
	FacilityID int64   `json:"facility_id"`
	State      string  `json:"state"`
	MaxPayload float64 `json:"max_payload"`
}

type AssetResponse struct {
	AssetID    string  `json:"asset_id"`
	FacilityID int64   `json:"facility_id"`
	State      string  `json:"state"`
	MaxPayload float64 `json:"max_payload"`
}

type AssetStateRequest struct {
	State string `json:"state"`
}

type TelemetryRequest struct {
	RecordedAt  time.Time      `json:"recorded_at"`
	Temperature float64        `json:"temperature"`
	Metrics     map[string]any `json:"metrics"`
}

type FacilityMetrics struct {
	FacilityID  int64      `json:"facility_id"`
	TotalAssets int        `json:"total_assets"`
	AvgCPULoad  *float64   `json:"avg_cpu_load"`
	LastEventAt *time.Time `json:"last_event_time"`
}

// ── Entry point ───────────────────────────────────────────────────────────────

func main() {
	connStr := os.Getenv("DATABASE_URL")
	if connStr == "" {
		log.Fatal("DATABASE_URL is not set")
	}

	var err error
	pool, err = pgxpool.New(context.Background(), connStr)
	if err != nil {
		log.Fatalf("Failed to create connection pool: %v", err)
	}
	defer pool.Close()

	mux := http.NewServeMux()

	// Infra
	mux.HandleFunc("GET /health", healthHandler)

	// Tenants
	mux.HandleFunc("POST /tenants", createTenantHandler)
	mux.HandleFunc("GET /tenants/{id}", getTenantHandler)

	// Facilities
	mux.HandleFunc("POST /facilities", createFacilityHandler)
	mux.HandleFunc("GET /facilities/{id}", getFacilityHandler)
	mux.HandleFunc("GET /facilities/{id}/metrics", getFacilityMetricsHandler)
	mux.HandleFunc("POST /facilities/{id}/refresh", refreshMetricsHandler)

	// Assets
	mux.HandleFunc("POST /assets", createAssetHandler)
	mux.HandleFunc("GET /assets/{id}", getAssetHandler)
	mux.HandleFunc("PATCH /assets/{id}/state", updateAssetStateHandler)

	// Telemetry
	mux.HandleFunc("POST /assets/{id}/telemetry", createTelemetryHandler)
	mux.HandleFunc("GET /assets/{id}/telemetry", listTelemetryHandler)

	// Legacy all-in-one
	mux.HandleFunc("GET /run", runHandler)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	fmt.Printf("Server listening on :%s\n", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("writeJSON encode error: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func decode(r *http.Request, dst any) error {
	return json.NewDecoder(r.Body).Decode(dst)
}

// getOrCreateTenantByName inserts a tenant when absent and returns the existing
// tenant when the name already exists. It also refreshes config on existing rows.
func getOrCreateTenantByName(ctx context.Context, name string, configJSON string) (TenantResponse, bool, error) {
	var resp TenantResponse

	// Handle all unique constraints without coupling to a specific index/column.
	err := pool.QueryRow(ctx, `
		INSERT INTO tenants (name, config)
		VALUES ($1, $2)
		ON CONFLICT DO NOTHING
		RETURNING tenant_id, name, config, created_at
	`, name, configJSON).Scan(&resp.TenantID, &resp.Name, &resp.Config, &resp.CreatedAt)
	if err == nil {
		return resp, true, nil
	}
	if err != pgx.ErrNoRows {
		return TenantResponse{}, false, err
	}

	// Row already exists: keep API behavior by updating config and returning it.
	err = pool.QueryRow(ctx, `
		UPDATE tenants
		SET config = $2
		WHERE name = $1
		RETURNING tenant_id, name, config, created_at
	`, name, configJSON).Scan(&resp.TenantID, &resp.Name, &resp.Config, &resp.CreatedAt)
	if err == nil {
		return resp, false, nil
	}
	if err != pgx.ErrNoRows {
		return TenantResponse{}, false, err
	}

	// Race-safe fallback: fetch existing row if another writer updated first.
	err = pool.QueryRow(ctx, `
		SELECT tenant_id, name, config, created_at
		FROM tenants
		WHERE name = $1
	`, name).Scan(&resp.TenantID, &resp.Name, &resp.Config, &resp.CreatedAt)
	if err != nil {
		return TenantResponse{}, false, err
	}

	return resp, false, nil
}

// setRLS runs set_config so Row Level Security policies see the correct tenant.
func setRLS(ctx context.Context, tx pgx.Tx, tenantID string) error {
	_, err := tx.Exec(ctx, "SELECT set_config('app.current_tenant', $1, true)", tenantID)
	return err
}

// ── Handlers ──────────────────────────────────────────────────────────────────

func healthHandler(w http.ResponseWriter, r *http.Request) {
	version, buildTime := buildVersionInfo()
	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "ok",
		"version":     version,
		"build_time":  buildTime,
		"deployed_at": time.Now().UTC().Format(time.RFC3339),
	})
}

func buildVersionInfo() (string, string) {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "unknown", ""
	}

	version := "unknown"
	buildTime := ""
	for _, s := range info.Settings {
		switch s.Key {
		case "vcs.revision":
			if len(s.Value) >= 8 {
				version = s.Value[:8]
			} else if s.Value != "" {
				version = s.Value
			}
		case "vcs.time":
			buildTime = s.Value
		}
	}

	if version == "unknown" && strings.TrimSpace(info.Main.Version) != "" && info.Main.Version != "(devel)" {
		version = info.Main.Version
	}

	return version, buildTime
}

// POST /tenants
func createTenantHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req TenantRequest
	if err := decode(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.Config == nil {
		req.Config = map[string]any{}
	}
	configJSON, _ := json.Marshal(req.Config)

	resp, created, err := getOrCreateTenantByName(ctx, req.Name, string(configJSON))
	if err != nil {
		log.Printf("createTenant: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to create tenant")
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, resp)
}

// GET /tenants/{id}
func getTenantHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("id")

	var resp TenantResponse
	err := pool.QueryRow(ctx,
		`SELECT tenant_id, name, config, created_at FROM tenants WHERE tenant_id = $1`, id,
	).Scan(&resp.TenantID, &resp.Name, &resp.Config, &resp.CreatedAt)
	if err == pgx.ErrNoRows {
		writeError(w, http.StatusNotFound, "tenant not found")
		return
	}
	if err != nil {
		log.Printf("getTenant: %v", err)
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// POST /facilities
func createFacilityHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req FacilityRequest
	if err := decode(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.TenantID == "" {
		writeError(w, http.StatusBadRequest, "tenant_id is required")
		return
	}
	if req.Features == nil {
		req.Features = []string{}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "begin tx failed")
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := setRLS(ctx, tx, req.TenantID); err != nil {
		writeError(w, http.StatusInternalServerError, "rls setup failed")
		return
	}

	var resp FacilityResponse
	err = tx.QueryRow(ctx, `
		INSERT INTO facilities (tenant_id, location, features)
		VALUES ($1, ROW($2, $3)::geo_point, $4)
		RETURNING facility_id, tenant_id, (location).latitude, (location).longitude, features
	`, req.TenantID, req.Lat, req.Lon, req.Features,
	).Scan(&resp.FacilityID, &resp.TenantID, &resp.Latitude, &resp.Longitude, &resp.Features)
	if err != nil {
		log.Printf("createFacility: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to create facility")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeError(w, http.StatusInternalServerError, "commit failed")
		return
	}
	writeJSON(w, http.StatusCreated, resp)
}

// GET /facilities/{id}
func getFacilityHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("id")

	var resp FacilityResponse
	err := pool.QueryRow(ctx, `
		SELECT facility_id, tenant_id, (location).latitude, (location).longitude, features
		FROM facilities WHERE facility_id = $1
	`, id).Scan(&resp.FacilityID, &resp.TenantID, &resp.Latitude, &resp.Longitude, &resp.Features)
	if err == pgx.ErrNoRows {
		writeError(w, http.StatusNotFound, "facility not found")
		return
	}
	if err != nil {
		log.Printf("getFacility: %v", err)
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// GET /facilities/{id}/metrics
func getFacilityMetricsHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("id")

	var m FacilityMetrics
	err := pool.QueryRow(ctx, `
		SELECT facility_id, total_assets, avg_cpu_load, last_event_time
		FROM mv_facility_metrics WHERE facility_id = $1
	`, id).Scan(&m.FacilityID, &m.TotalAssets, &m.AvgCPULoad, &m.LastEventAt)
	if err == pgx.ErrNoRows {
		writeError(w, http.StatusNotFound, "no metrics (run refresh first)")
		return
	}
	if err != nil {
		log.Printf("getFacilityMetrics: %v", err)
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	writeJSON(w, http.StatusOK, m)
}

// POST /facilities/{id}/refresh — triggers REFRESH MATERIALIZED VIEW CONCURRENTLY
func refreshMetricsHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	_, err := pool.Exec(ctx, "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_facility_metrics")
	if err != nil {
		log.Printf("refreshMetrics: %v", err)
		writeError(w, http.StatusInternalServerError, "refresh failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "refreshed"})
}

// POST /assets
func createAssetHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req AssetRequest
	if err := decode(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.FacilityID == 0 {
		writeError(w, http.StatusBadRequest, "facility_id is required")
		return
	}
	if req.State == "" {
		req.State = "pending"
	}

	var resp AssetResponse
	err := pool.QueryRow(ctx, `
		INSERT INTO assets (facility_id, state, max_payload)
		VALUES ($1, $2, $3)
		RETURNING asset_id, facility_id, state, max_payload
	`, req.FacilityID, req.State, req.MaxPayload,
	).Scan(&resp.AssetID, &resp.FacilityID, &resp.State, &resp.MaxPayload)
	if err != nil {
		log.Printf("createAsset: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to create asset")
		return
	}
	writeJSON(w, http.StatusCreated, resp)
}

// GET /assets/{id}
func getAssetHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("id")

	var resp AssetResponse
	err := pool.QueryRow(ctx,
		`SELECT asset_id, facility_id, state, max_payload FROM assets WHERE asset_id = $1`, id,
	).Scan(&resp.AssetID, &resp.FacilityID, &resp.State, &resp.MaxPayload)
	if err == pgx.ErrNoRows {
		writeError(w, http.StatusNotFound, "asset not found")
		return
	}
	if err != nil {
		log.Printf("getAsset: %v", err)
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// PATCH /assets/{id}/state
func updateAssetStateHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("id")

	var req AssetStateRequest
	if err := decode(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	validStates := map[string]bool{"pending": true, "active": true, "maintenance": true, "decommissioned": true}
	if !validStates[req.State] {
		writeError(w, http.StatusBadRequest, "invalid state; must be pending|active|maintenance|decommissioned")
		return
	}

	var resp AssetResponse
	err := pool.QueryRow(ctx,
		`UPDATE assets SET state = $1 WHERE asset_id = $2 RETURNING asset_id, facility_id, state, max_payload`,
		req.State, id,
	).Scan(&resp.AssetID, &resp.FacilityID, &resp.State, &resp.MaxPayload)
	if err == pgx.ErrNoRows {
		writeError(w, http.StatusNotFound, "asset not found")
		return
	}
	if err != nil {
		log.Printf("updateAssetState: %v", err)
		writeError(w, http.StatusInternalServerError, "update failed")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// POST /assets/{id}/telemetry
func createTelemetryHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	assetID := r.PathValue("id")

	var req TelemetryRequest
	if err := decode(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.RecordedAt.IsZero() {
		req.RecordedAt = time.Now()
	}
	if req.Metrics == nil {
		req.Metrics = map[string]any{}
	}
	metricsJSON, _ := json.Marshal(req.Metrics)

	_, err := pool.Exec(ctx, `
		INSERT INTO telemetry_events (asset_id, recorded_at, temperature, metrics)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT DO NOTHING
	`, assetID, req.RecordedAt, req.Temperature, string(metricsJSON))
	if err != nil {
		log.Printf("createTelemetry: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to insert telemetry")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"status": "recorded"})
}

// GET /assets/{id}/telemetry?limit=50
func listTelemetryHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	assetID := r.PathValue("id")
	limit := 50

	type event struct {
		EventID     int64          `json:"event_id"`
		RecordedAt  time.Time      `json:"recorded_at"`
		Temperature *float64       `json:"temperature"`
		Metrics     map[string]any `json:"metrics"`
	}

	rows, err := pool.Query(ctx, `
		SELECT event_id, recorded_at, temperature, metrics
		FROM telemetry_events
		WHERE asset_id = $1
		ORDER BY recorded_at DESC
		LIMIT $2
	`, assetID, limit)
	if err != nil {
		log.Printf("listTelemetry: %v", err)
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	events := []event{}
	for rows.Next() {
		var e event
		if err := rows.Scan(&e.EventID, &e.RecordedAt, &e.Temperature, &e.Metrics); err != nil {
			log.Printf("listTelemetry scan: %v", err)
			continue
		}
		events = append(events, e)
	}
	writeJSON(w, http.StatusOK, events)
}

// GET /run — all-in-one seed + query (kept for backward compat / k6 smoke scenario)
func runHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	results := map[string]any{}

	tenantResp, _, err := getOrCreateTenantByName(ctx, "Alpha Logistics", `{"region": "eu-west-1"}`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("tenant: %v", err))
		return
	}
	tenantID := tenantResp.TenantID
	results["tenant_id"] = tenantID

	tx, err := pool.Begin(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "begin tx failed")
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := setRLS(ctx, tx, tenantID); err != nil {
		writeError(w, http.StatusInternalServerError, "rls failed")
		return
	}

	var facilityID int64
	err = tx.QueryRow(ctx, `
		INSERT INTO facilities (tenant_id, location, features)
		VALUES ($1, ROW($2, $3)::geo_point, $4)
		RETURNING facility_id
	`, tenantID, 53.349805, -6.260310, []string{"cold-storage", "hazmat"}).Scan(&facilityID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("facility: %v", err))
		return
	}
	results["facility_id"] = facilityID

	var assetID string
	err = tx.QueryRow(ctx, `
		INSERT INTO assets (facility_id, state, max_payload, metadata)
		VALUES ($1, 'active', $2, $3)
		RETURNING asset_id
	`, facilityID, 2500.00, `{"manufacturer": "Scania", "model": "R500"}`).Scan(&assetID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("asset: %v", err))
		return
	}
	results["asset_id"] = assetID

	_, err = tx.Exec(ctx, `
		INSERT INTO telemetry_events (asset_id, recorded_at, temperature, metrics)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT DO NOTHING
	`, assetID, time.Now(), -4.2, `{"cpu_load": 12.5, "battery_pct": 88}`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("telemetry: %v", err))
		return
	}

	_, err = tx.Exec(ctx, "REFRESH MATERIALIZED VIEW mv_facility_metrics")
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("refresh: %v", err))
		return
	}

	var totalAssets int
	var avgCPU *float64
	err = tx.QueryRow(ctx, `
		SELECT total_assets, avg_cpu_load FROM mv_facility_metrics WHERE facility_id = $1
	`, facilityID).Scan(&totalAssets, &avgCPU)
	if err != nil && err != pgx.ErrNoRows {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("metrics: %v", err))
		return
	}
	results["total_assets"] = totalAssets
	results["avg_cpu_load"] = avgCPU

	if err := tx.Commit(ctx); err != nil {
		writeError(w, http.StatusInternalServerError, "commit failed")
		return
	}
	writeJSON(w, http.StatusOK, results)
}
