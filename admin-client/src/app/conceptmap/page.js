"use client";
import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";

const ConceptMapPage = () => {
  const [maps, setMaps] = useState([]);
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchConceptMaps = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/fhir/ConceptMap`, {
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_API_TOKEN}`,
        },
      });

      if (!response.ok) throw new Error("Failed to fetch ConceptMaps");

      const data = await response.json();
      setBundle(data);
      setMaps(data.entry || []);
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConceptMaps();
  }, []);

  // Helper to download JSON as file
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
          <CardTitle className="text-xl font-semibold">Concept Maps</CardTitle>
          {bundle && (
            <Button
              onClick={() => downloadJSON(bundle, "conceptmap-bundle.json")}
              size="sm"
            >
              Download Bundle
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {error && <p className="text-red-600 mb-2">{error}</p>}

          {loading ? (
            <p>Loading...</p>
          ) : maps.length === 0 ? (
            <p>No ConceptMaps found.</p>
          ) : (
            maps.map((entry) => {
              const map = entry.resource;
              return (
                <Card key={map.id} className="mb-4 border shadow-sm rounded-xl">
                  <CardHeader className="flex justify-between items-center">
                    <CardTitle className="text-lg font-semibold">{map.title}</CardTitle>
                    <Button
                      size="sm"
                      onClick={() => downloadJSON(map, `${map.id}.json`)}
                    >
                      Download
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <p><strong>Name:</strong> {map.name}</p>
                    <p><strong>Status:</strong> {map.status}</p>
                    <p><strong>Publisher:</strong> {map.publisher}</p>
                    <p><strong>Description:</strong> {map.description}</p>
                    <p><strong>Source URI:</strong> {map.sourceUri}</p>
                    <p><strong>Target URI:</strong> {map.targetUri}</p>

                    {map.group && map.group.map((group, gIndex) => (
                      <div key={gIndex} className="mt-4">
                        <p className="font-medium">Mappings:</p>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Source Code</TableHead>
                              <TableHead>Source Display</TableHead>
                              <TableHead>Target Code</TableHead>
                              <TableHead>Target Display</TableHead>
                              <TableHead>Equivalence</TableHead>
                              <TableHead>Comment</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {group.element.map((el, i) =>
                              el.target.map((t, j) => (
                                <TableRow key={`${i}-${j}`}>
                                  <TableCell>{el.code}</TableCell>
                                  <TableCell>{el.display}</TableCell>
                                  <TableCell>{t.code}</TableCell>
                                  <TableCell>{t.display}</TableCell>
                                  <TableCell>{t.equivalence}</TableCell>
                                  <TableCell>{t.comment}</TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    ))}
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

export default ConceptMapPage;
