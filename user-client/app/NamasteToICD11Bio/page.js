"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";

export default function NamasteToICD11Bio() {
  const [mappings, setMappings] = useState([]);
  const [filteredMappings, setFilteredMappings] = useState([]);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [loading, setLoading] = useState(false);

  const [primaryFilter, setPrimaryFilter] = useState("all");
  const [secondaryFilter, setSecondaryFilter] = useState("");

  const [codeOptions, setCodeOptions] = useState([]);
  const [displayOptions, setDisplayOptions] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        let token = localStorage.getItem("access_token");
        if (!token) {
          const tokenRes = await axios.post(
            "http://localhost:3001/auth/generate-token",
            {
              user: "admin-user",
              role: "admin",
              facilityId: "ministry-of-ayush",
              name: "System Administrator",
              healthId: "91-9999-8888-7777",
              expiresIn: "24h",
            }
          );
          token = tokenRes.data.access_token;
          localStorage.setItem("access_token", token);
        }

        const response = await axios.get(
          "http://localhost:3001/fhir/ConceptMap/namaste-to-icd11-bio",
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "ngrok-skip-browser-warning": 69420,
            },
          }
        );

        const elements = response.data?.group?.[0]?.element || [];
        setMappings(elements);
        setFilteredMappings(elements);

        // Dynamically extract unique ICD codes and displays
        const codes = Array.from(
          new Set(elements.map((item) => item.target?.[0]?.code).filter(Boolean))
        );
        const displays = Array.from(
          new Set(elements.map((item) => item.target?.[0]?.display).filter(Boolean))
        );

        setCodeOptions(codes);
        setDisplayOptions(displays);

      } catch (err) {
        console.error("Error fetching mappings:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Filtering logic
  useEffect(() => {
    let filtered = [...mappings];

    if (primaryFilter === "icdCode" && secondaryFilter) {
      filtered = filtered.filter(item => item.target?.[0]?.code === secondaryFilter);
    } else if (primaryFilter === "icdDisplay" && secondaryFilter) {
      filtered = filtered.filter(item => item.target?.[0]?.display === secondaryFilter);
    }

    setFilteredMappings(filtered);
    setPage(1);
  }, [primaryFilter, secondaryFilter, mappings]);

  const startIndex = (page - 1) * pageSize;
  const paginatedMappings = filteredMappings.slice(startIndex, startIndex + pageSize);
  const totalPages = Math.ceil(filteredMappings.length / pageSize);

  return (
    <div className="px-6 max-w-6xl mx-auto flex flex-col min-h-screen ml-100">
      {/* Header */}
      <div className="mb-3 text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          NAMASTE → ICD-11 Bio
        </h1>
        <p className="text-gray-600">
          Mapping between NAMASTE codes and WHO ICD-11 Bio
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-4 items-center">
        <select
          value={primaryFilter}
          onChange={(e) => {
            setPrimaryFilter(e.target.value);
            setSecondaryFilter("");
          }}
          className="p-2 border rounded-md"
        >
          <option value="all">All</option>
          <option value="icdCode">ICD-11 Bio Code</option>
          <option value="icdDisplay">ICD-11 Bio Display</option>
        </select>

        <select
          value={secondaryFilter}
          onChange={(e) => setSecondaryFilter(e.target.value)}
          className="p-2 border rounded-md"
          disabled={primaryFilter === "all"}
        >
          <option value="">Select</option>
          {primaryFilter === "icdCode" &&
            codeOptions.map((code) => <option key={code} value={code}>{code}</option>)}
          {primaryFilter === "icdDisplay" &&
            displayOptions.map((display) => <option key={display} value={display}>{display}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <p className="text-gray-500 animate-pulse">Loading mappings...</p>
        </div>
      ) : filteredMappings.length === 0 ? (
        <p className="text-gray-500">No mappings found.</p>
      ) : (
        <>
          <div className="bg-white border rounded-2xl shadow-md overflow-hidden">
            <Table>
              <TableHeader className="bg-gradient-to-r from-blue-50 to-emerald-50">
                <TableRow>
                  <TableHead className="w-[180px] text-gray-800 font-semibold">NAMASTE Code</TableHead>
                  <TableHead className="w-[280px] text-gray-800 font-semibold">NAMASTE Display</TableHead>
                  <TableHead className="w-[180px] text-gray-800 font-semibold">ICD-11 Bio Code</TableHead>
                  <TableHead className="text-gray-800 font-semibold">ICD-11 Bio Display</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedMappings.map((item, index) => {
                  const target = item.target?.[0] || {};
                  return (
                    <TableRow
                      key={item.code}
                      className={index % 2 === 0 ? "bg-white" : "bg-gray-50 hover:bg-gray-100 transition"}
                    >
                      <TableCell className="font-medium text-gray-900">{item.code}</TableCell>
                      <TableCell className="text-gray-700">{item.display}</TableCell>
                      <TableCell className="font-medium text-emerald-700">{target.code}</TableCell>
                      <TableCell className="text-gray-700">
                        {target.display}
                        <div className="text-xs text-gray-500 mt-1">
                          {target.comment && <span>{target.comment}</span>}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex justify-center items-center gap-4 mt-3">
            <Button
              variant="outline"
              onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
              disabled={page === 1}
              className="rounded-full"
            >
              Previous
            </Button>
            <span className="text-gray-700 font-medium">Page {page} of {totalPages}</span>
            <Button
              variant="outline"
              onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))}
              disabled={page === totalPages}
              className="rounded-full"
            >
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
