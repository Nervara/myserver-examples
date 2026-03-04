// main.go
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	ctx := context.Background()
	connStr := os.Getenv("DATABASE_URL")

	if connStr == "" {
		panic("DATABASE_URL is not set")
	}

	pool, err := pgxpool.New(ctx, connStr)
	if err != nil {
		log.Fatalf("Failed to create connection pool: %v", err)
	}
	defer pool.Close()

	var tenantID string
	err = pool.QueryRow(ctx, `
		INSERT INTO tenants (name, config) 
		VALUES ($1, $2) 
		RETURNING tenant_id
	`, "Alpha Logistics", `{"region": "eu-west-1"}`).Scan(&tenantID)
	if err != nil {
		log.Fatalf("Tenant insert failed: %v", err)
	}
	fmt.Printf("Tenant created: %s\n", tenantID)

	tx, err := pool.Begin(ctx)
	if err != nil {
		log.Fatalf("Transaction begin failed: %v", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	_, err = tx.Exec(ctx, "SELECT set_config('app.current_tenant', $1, true)", tenantID)
	if err != nil {
		log.Fatalf("RLS context setup failed: %v", err)
	}

	var facilityID int64
	err = tx.QueryRow(ctx, `
		INSERT INTO facilities (tenant_id, location, features) 
		VALUES ($1, ROW($2, $3)::geo_point, $4) 
		RETURNING facility_id
	`, tenantID, 53.349805, -6.260310, []string{"cold-storage", "hazmat"}).Scan(&facilityID)
	if err != nil {
		log.Fatalf("Facility insert failed: %v", err)
	}
	fmt.Printf("Facility created: %d\n", facilityID)

	var assetID string
	err = tx.QueryRow(ctx, `
		INSERT INTO assets (facility_id, state, max_payload, metadata) 
		VALUES ($1, 'active', $2, $3) 
		RETURNING asset_id
	`, facilityID, 2500.00, `{"manufacturer": "Scania", "model": "R500"}`).Scan(&assetID)
	if err != nil {
		log.Fatalf("Asset insert failed: %v", err)
	}
	fmt.Printf("Asset created: %s\n", assetID)

	_, err = tx.Exec(ctx, `
		INSERT INTO telemetry_events (asset_id, recorded_at, temperature, metrics) 
		VALUES ($1, $2, $3, $4)
	`, assetID, time.Now(), -4.2, `{"cpu_load": 12.5, "battery_pct": 88}`)
	if err != nil {
		log.Fatalf("Telemetry insert failed: %v", err)
	}

	_, err = tx.Exec(ctx, "REFRESH MATERIALIZED VIEW mv_facility_metrics")
	if err != nil {
		log.Fatalf("Materialized view refresh failed: %v", err)
	}

	var totalAssets int
	var avgCPU float64
	err = tx.QueryRow(ctx, `
		SELECT total_assets, avg_cpu_load 
		FROM mv_facility_metrics 
		WHERE facility_id = $1
	`, facilityID).Scan(&totalAssets, &avgCPU)
	if err != nil && err != pgx.ErrNoRows {
		log.Fatalf("Materialized view query failed: %v", err)
	}
	fmt.Printf("Metrics [Facility %d]: Assets=%d, Avg CPU=%.2f\n", facilityID, totalAssets, avgCPU)

	if err := tx.Commit(ctx); err != nil {
		log.Fatalf("Transaction commit failed: %v", err)
	}
}
