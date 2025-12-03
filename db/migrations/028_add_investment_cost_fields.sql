-- Migration 028: Add investment cost fields to pool_sites
-- These fields support Energy Analysis payback calculations
--
-- Investment formula:
--   HP Investment = hp_base_cost + (hp_capacity_kw * hp_marginal_cost_per_kw)
--   Boiler Investment = boiler_base_cost + (boiler_capacity_kw * boiler_marginal_cost_per_kw)
--   Total Investment = HP Investment + Boiler Investment
--
-- Payback formula:
--   Payback (years) = Additional Investment / Annual Energy Savings

ALTER TABLE pool_sites
    ADD COLUMN hp_base_cost_nok DECIMAL(10,2) DEFAULT NULL COMMENT 'Base installation cost for heat pump (NOK)',
    ADD COLUMN hp_marginal_cost_per_kw DECIMAL(8,2) DEFAULT NULL COMMENT 'Cost per kW for heat pump (NOK/kW)',
    ADD COLUMN boiler_base_cost_nok DECIMAL(10,2) DEFAULT NULL COMMENT 'Base installation cost for boiler (NOK)',
    ADD COLUMN boiler_marginal_cost_per_kw DECIMAL(8,2) DEFAULT NULL COMMENT 'Cost per kW for boiler (NOK/kW)';

-- Verification query (run after migration)
-- SELECT id, name, hp_base_cost_nok, hp_marginal_cost_per_kw, boiler_base_cost_nok, boiler_marginal_cost_per_kw FROM pool_sites;
