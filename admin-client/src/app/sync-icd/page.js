"use client";
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SyncICDPage = () => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleSync = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL}/admin/sync-icd11`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_API_TOKEN}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error("Sync failed");
      }

      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <Card className="w-full max-w-md shadow-lg rounded-2xl">
        <CardHeader>
          <CardTitle className="text-xl font-semibold">
            Sync NAMASTE → ICD-11
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            className="w-full"
            onClick={handleSync}
            disabled={loading}
          >
            {loading ? "Syncing..." : "Start Sync"}
          </Button>

          {error && (
            <p className="text-sm text-red-600 text-center">{error}</p>
          )}

          {result && (
            <div className="mt-4 text-sm space-y-1">
              <p className="font-medium text-green-700">{result.message}</p>
              <p>✅ Success: {String(result.result.success)}</p>
              <p>📖 TM2 Categories: {result.result.tm2Categories}</p>
              <p>⚕️ Biomedicine Categories: {result.result.biomedicineCategories}</p>
              <p>🕒 Timestamp: {new Date(result.result.timestamp).toLocaleString()}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SyncICDPage;
