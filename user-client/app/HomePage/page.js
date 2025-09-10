"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// Count-up hook
function useCountUp(end, duration = 2000) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let start = 0;
    const increment = end / (duration / 16);
    const timer = setInterval(() => {
      start += increment;
      if (start >= end) {
        setCount(end);
        clearInterval(timer);
      } else {
        setCount(Math.floor(start));
      }
    }, 16);
    return () => clearInterval(timer);
  }, [end, duration]);

  return count;
}

// Data
const tm2Data = [
  { code: "TM2.A0", value: 352 },
  { code: "TM2.A1", value: 201 },
  { code: "TM2.A2", value: 150 },
  { code: "TM2.B0", value: 16 },
  { code: "TM2.C0", value: 1 },
  { code: "TM2.D0", value: 3 },
  { code: "TM2.E0", value: 1 },
];

const bioData = [
  { code: "DA00", value: 19 },
  { code: "6A00", value: 1 },
];

export default function HomePage() {
  const totalNamaste = useCountUp(2888);
  const totalTm2 = useCountUp(724);
  const totalBio = useCountUp(20);

  return (
    <div className="max-w-7xl ml-100 p-6 space-y-6">
      {/* Row 1 → Totals */}
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Totals</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
          <div>
            <p className="text-gray-600 text-sm">Total Namaste</p>
            <p className="text-4xl font-bold text-blue-600">{totalNamaste}</p>
          </div>
          <div>
            <p className="text-gray-600 text-sm">Namaste → ICD11 TM2</p>
            <p className="text-4xl font-bold text-green-600">{totalTm2}</p>
          </div>
          <div>
            <p className="text-gray-600 text-sm">Namaste → ICD11 BIO</p>
            <p className="text-4xl font-bold text-purple-600">{totalBio}</p>
          </div>
        </CardContent>
      </Card>

      {/* Row 2 → Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* TM2 Chart */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Namaste To ICD11 TM2 Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tm2Data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="code" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#16a34a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* BIO Chart */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Namaste To ICD11 BIO Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bioData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="code" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#9333ea" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
