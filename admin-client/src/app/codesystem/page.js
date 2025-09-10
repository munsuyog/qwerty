"use client";
import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const CodeSystemPage = () => {
  const [systems, setSystems] = useState([]);
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchCodeSystems = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/fhir/CodeSystem`, {
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_API_TOKEN}`,
        },
      });

      if (!response.ok) throw new Error("Failed to fetch CodeSystems");

      const data = await response.json();
      setBundle(data);
      setSystems(data.entry || []);
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCodeSystems();
  }, []);

  const downloadJSON = (data, filename) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <Card className="shadow-lg rounded-2xl">
        <CardHeader className="flex justify-between items-center">
          <CardTitle className="text-xl font-semibold">Code Systems</CardTitle>
          {bundle && (
            <Button size="sm" onClick={() => downloadJSON(bundle, "codesystem-bundle.json")}>
              Download Bundle
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {error && <p className="text-red-600 mb-2">{error}</p>}

          {loading ? (
            <p>Loading...</p>
          ) : systems.length === 0 ? (
            <p>No CodeSystems found.</p>
          ) : (
            systems.map((entry) => {
              const system = entry.resource;
              return (
                <Card key={system.id} className="mb-4 border shadow-sm rounded-xl">
                  <CardHeader className="flex justify-between items-center">
                    <CardTitle className="text-lg font-semibold">{system.name}</CardTitle>
                    <Button size="sm" onClick={() => downloadJSON(system, `${system.id}.json`)}>
                      Download
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <p><strong>Title:</strong> {system.title || system.name}</p>
                    <p><strong>Status:</strong> {system.status}</p>
                    <p><strong>Publisher:</strong> {system.publisher}</p>
                    <p><strong>Description:</strong> {system.description}</p>
                    <p><strong>URL:</strong> {system.url}</p>
                    <p><strong>Version:</strong> {system.version}</p>
                    <p><strong>Total Concepts:</strong> {system.concept ? system.concept.length : 0}</p>
                  </CardContent>
                </Card>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CodeSystemPage;
