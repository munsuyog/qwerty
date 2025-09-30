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

export default function NamasteCode() {
  const [concepts, setConcepts] = useState([]);
  const [page, setPage] = useState(1);
  const pageSize = 500;
  const [loading, setLoading] = useState(false);

  // Step 1: Get token & fetch concepts
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
          "http://localhost:3001/fhir/CodeSystem/namaste",
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "ngrok-skip-browser-warning": 69420,
            },
          }
        );

        setConcepts(response.data.concept || []);
      } catch (err) {
        console.error("Error fetching data:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Pagination logic
  const startIndex = (page - 1) * pageSize;
  const paginatedConcepts = concepts.slice(startIndex, startIndex + pageSize);
  const totalPages = Math.ceil(concepts.length / pageSize);

return (
  <div className="px-6 max-w-6xl mx-auto flex flex-col min-h-screen ml-100">
    {/* Header */}
    <div className="mb-3">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">NAMASTE Concepts</h1>
    </div>

    {loading ? (
      <div className="flex justify-center items-center py-20">
        <p className="text-gray-500 animate-pulse">Loading...</p>
      </div>
    ) : concepts.length === 0 ? (
      <p className="text-gray-500">No concepts found.</p>
    ) : (
      <>
        {/* Table Card */}
        <div className="bg-white border rounded-2xl shadow-md overflow-hidden">
          <Table>
            <TableHeader className="bg-gradient-to-r from-yellow-50 to-indigo-50">
              <TableRow>
                <TableHead className="w-[150px] text-gray-800 font-semibold">Code</TableHead>
                <TableHead className="text-gray-800 font-semibold">Display</TableHead>
                <TableHead className="text-gray-800 font-semibold">Definition</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedConcepts.map((item, index) => (
                <TableRow
                  key={item.code}
                  className={index % 2 === 0 ? "bg-white" : "bg-gray-50 hover:bg-gray-100 transition"}
                >
                  <TableCell className="font-medium text-gray-900">{item.code}</TableCell>
                  <TableCell className="text-gray-800">{item.display}</TableCell>
                  <TableCell className="text-gray-600 text-sm">{item.definition}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Pagination Controls */}
        <div className="flex justify-center items-center gap-4 mt-3">
          <Button
            variant="outline"
            onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
            disabled={page === 1}
            className="rounded-full"
          >
            Previous
          </Button>
          <span className="text-gray-700 font-medium">
            Page {page} of {totalPages}
          </span>
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
