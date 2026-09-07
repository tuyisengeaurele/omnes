/**
 * GeoPort: proximity queries ("drivers near this pickup", "merchants near
 * this address"). The MVP implementation is an indexed lat/lng bounding-box
 * prefilter plus haversine in application code; PostGIS is a later adapter
 * behind the same interface if it is ever needed.
 */

export {};
