"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LocationPickerProps {
  value: string;
  onChange: (latLon: string) => void;
}

const MAP_ID = "wastewise-setup-map";

function parseLatLon(v: string): { lat: number; lng: number } | null {
  const [latStr, lonStr] = v.split(",");
  const lat = Number(latStr);
  const lng = Number(lonStr);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function formatLatLon(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function PlacesSearch({ onPick }: { onPick: (lat: number, lng: number, label: string) => void }) {
  const places = useMapsLibrary("places");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!places || !inputRef.current) return;
    const ac = new places.Autocomplete(inputRef.current, { fields: ["geometry", "formatted_address", "name"] });
    const listener = ac.addListener("place_changed", () => {
      const p = ac.getPlace();
      const loc = p.geometry?.location;
      if (!loc) return;
      onPick(loc.lat(), loc.lng(), p.formatted_address ?? p.name ?? "");
    });
    return () => listener.remove();
  }, [places, onPick]);

  return (
    <Input
      ref={inputRef}
      placeholder="Search a place (e.g. Times Square)"
      className="border-zinc-200"
    />
  );
}

function MapClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const listener = map.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      onClick(e.latLng.lat(), e.latLng.lng());
    });
    return () => listener.remove();
  }, [map, onClick]);
  return null;
}

function MapRecenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    map.panTo({ lat, lng });
  }, [map, lat, lng]);
  return null;
}

function ReverseGeocode({ lat, lng, onLabel }: { lat: number; lng: number; onLabel: (s: string) => void }) {
  const geocoding = useMapsLibrary("geocoding");
  useEffect(() => {
    if (!geocoding) return;
    const g = new geocoding.Geocoder();
    let cancelled = false;
    g.geocode({ location: { lat, lng } })
      .then((res) => {
        if (cancelled) return;
        onLabel(res.results[0]?.formatted_address ?? "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [geocoding, lat, lng, onLabel]);
  return null;
}

export function LocationPicker({ value, onChange }: LocationPickerProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const initial = useMemo(() => parseLatLon(value) ?? { lat: 40.7, lng: -74.0 }, [value]);
  const [point, setPoint] = useState(initial);
  const [label, setLabel] = useState("");

  const commit = useCallback(
    (lat: number, lng: number, nextLabel?: string) => {
      setPoint({ lat, lng });
      onChange(formatLatLon(lat, lng));
      if (nextLabel !== undefined) setLabel(nextLabel);
    },
    [onChange],
  );

  if (!apiKey) {
    return (
      <div className="space-y-2">
        <Label htmlFor="loc" className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Location (lat,lon)
        </Label>
        <Input
          id="loc"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="border-zinc-200 font-mono"
        />
        <p className="text-xs text-zinc-400">
          Set <code className="rounded bg-zinc-100 px-1 py-0.5">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> in .env.local to enable the map picker.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Location
      </Label>
      <APIProvider apiKey={apiKey}>
        <PlacesSearch onPick={(lat, lng, l) => commit(lat, lng, l)} />
        <div className="h-64 w-full overflow-hidden rounded-lg border border-zinc-200">
          <Map
            mapId={MAP_ID}
            defaultCenter={initial}
            defaultZoom={11}
            gestureHandling="greedy"
            disableDefaultUI={false}
          >
            <AdvancedMarker position={point} />
            <MapClickHandler onClick={(lat, lng) => commit(lat, lng)} />
            <MapRecenter lat={point.lat} lng={point.lng} />
            <ReverseGeocode lat={point.lat} lng={point.lng} onLabel={setLabel} />
          </Map>
        </div>
        <p className="text-xs text-zinc-500">
          <span className="font-mono">{formatLatLon(point.lat, point.lng)}</span>
          {label && <span className="text-zinc-400"> — {label}</span>}
        </p>
      </APIProvider>
    </div>
  );
}
