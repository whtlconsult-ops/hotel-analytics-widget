"use client";
import dynamic from "next/dynamic";

const MapInner = dynamic(() => import("./MapInner"), { ssr: false });
export default MapInner;

