"use client";
import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ValueSetPage = () => {
  const [bundles, setBundles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch ValueSet bundle
  const fetchValueSets = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/fhir/ValueSet`, {
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_API_TOKEN}`,
        },
      });
      if (!response.ok) throw new Error("Failed to fetch ValueSets");
      const data = await response.json();
      setBundles(data.entry || []);
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchValueSets();
  }, []);

  // Download entire bundle
  const handleDownloadAll = () => {
    const blob = new Blob([JSON.stringify({ entry: bundles }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ValueSetBundle.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Download single ValueSet
  const handleDownloadSingle = (vs) => {
    const blob = new Blob([JSON.stringify(vs, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${vs.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 flex flex-col items-center">
      <Card className="w-full max-w-4xl shadow-lg rounded-2xl">
        <CardHeader>
          <CardTitle className="text-xl font-semibold">ValueSets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            className="mb-4"
            onClick={handleDownloadAll}
            disabled={bundles.length === 0}
          >
            Download All ValueSets
          </Button>

          {loading && <p className="text-center">Loading...</p>}
          {error && <p className="text-center text-red-600">{error}</p>}

          {!loading && !error && bundles.length === 0 && (
            <p className="text-center">No ValueSets found.</p>
          )}

          <div className="grid gap-4">
            {bundles.map((entry) => {
              const vs = entry.resource;
              return (
                <Card key={vs.id} className="shadow rounded-lg">
                  <CardHeader className="flex justify-between items-center">
                    <CardTitle>{vs.title || vs.name}</CardTitle>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDownloadSingle(vs)}
                    >
                      Download
                    </Button>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1">
                    <p>
                      <strong>ID:</strong> {vs.id}
                    </p>
                    <p>
                      <strong>URL:</strong> {vs.url}
                    </p>
                    <p>
                      <strong>Status:</strong> {vs.status}
                    </p>
                    <p>
                      <strong>Version:</strong> {vs.version}
                    </p>
                    <p>
                      <strong>Publisher:</strong> {vs.publisher}
                    </p>
                    {vs.expansion && (
                      <p>
                        <strong>Total Codes:</strong> {vs.expansion.total}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ValueSetPage;
