"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { RefreshCw, Shuffle, Search, Filter, AlertCircle } from "lucide-react";
import { useState, useEffect } from "react";
import ForceDirectedGraph from "@/components/graphs/ForceDirectedGraph";
import DashboardLayout from "@/components/layouts/dashboard";

// Main Dashboard Component
const NAMASTEToDashboard = () => {
  const [conceptMappings, setConceptMappings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedNode, setSelectedNode] = useState(null);
  const [rotationAngle, setRotationAngle] = useState(0);

  // Configuration - replace with your actual values
  const API_CONFIG = {
    baseUrl: "http://localhost:3001", // Replace with actual base URL
    token:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbi11c2VyIiwiaGVhbHRoSWQiOiI5MS05OTk5LTg4ODgtNzc3NyIsIm5hbWUiOiJTeXN0ZW0gQWRtaW5pc3RyYXRvciIsInVzZXJUeXBlIjoiYWRtaW4iLCJmYWNpbGl0eUlkIjoibWluaXN0cnktb2YtYXl1c2giLCJpYXQiOjE3NTc0MTU2MTcsImV4cCI6MTc1NzUwMjAxNywiaXNzIjoibmFtYXN0ZS1maGlyLWRldiIsImF1ZCI6InRlcm1pbm9sb2d5LXNlcnZlciJ9.Ii-xXJ0ek1Y4gAVCUbHGB59MK99FyyZ-I3nGlwY0VLM", // Replace with actual token
  };

  // Fetch data from API
  const fetchConceptMappings = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `${API_CONFIG.baseUrl}/fhir/ConceptMap/namaste-to-icd11-tm2`,
        {
          headers: {
            Authorization: `Bearer ${API_CONFIG.token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Transform FHIR ConceptMap data to our component format
      const transformedData = [];

      if (data.group && data.group.length > 0) {
        data.group.forEach((group) => {
          if (group.element) {
            group.element.forEach((element) => {
              if (element.target && element.target.length > 0) {
                element.target.forEach((target) => {
                  transformedData.push({
                    namasteCode: element.code,
                    namasteDisplay: element.display,
                    icd11Code: target.code,
                    icd11Display: target.display,
                    equivalence: target.equivalence || "equivalent",
                    comment: target.comment || "",
                    category: inferCategory(element.display), // Helper function to categorize
                  });
                });
              }
            });
          }
        });
      }

      setConceptMappings(transformedData);
    } catch (err) {
      setError(err.message);
      console.error("Failed to fetch concept mappings:", err);
    } finally {
      setLoading(false);
    }
  };

  // Helper function to infer category from display name
  const inferCategory = (display) => {
    const displayLower = display.toLowerCase();
    if (
      displayLower.includes("vata") ||
      displayLower.includes("pitta") ||
      displayLower.includes("kapha")
    ) {
      return "Dosha Disorders";
    }
    if (displayLower.includes("fever") || displayLower.includes("jwara")) {
      return "Symptomatic";
    }
    if (
      displayLower.includes("digestive") ||
      displayLower.includes("grahani") ||
      displayLower.includes("atisara")
    ) {
      return "Digestive";
    }
    if (
      displayLower.includes("neuro") ||
      displayLower.includes("apasmara") ||
      displayLower.includes("head")
    ) {
      return "Neurological";
    }
    if (displayLower.includes("skin") || displayLower.includes("kustha")) {
      return "Dermatological";
    }
    if (
      displayLower.includes("metabolic") ||
      displayLower.includes("prameha")
    ) {
      return "Metabolic";
    }
    if (
      displayLower.includes("joint") ||
      displayLower.includes("bone") ||
      displayLower.includes("amavata")
    ) {
      return "Musculoskeletal";
    }
    return "General";
  };

  useEffect(() => {
    fetchConceptMappings();
  }, []);

  // Filter data based on search and category
  const filteredMappings = conceptMappings.filter((mapping) => {
    const matchesSearch =
      mapping.namasteDisplay.toLowerCase().includes(searchTerm.toLowerCase()) ||
      mapping.namasteCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      mapping.icd11Display.toLowerCase().includes(searchTerm.toLowerCase()) ||
      mapping.icd11Code.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCategory =
      selectedCategory === "all" || mapping.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  const categories = [
    "all",
    ...new Set(conceptMappings.map((m) => m.category)),
  ];

  const handleNodeClick = (node) => {
    setSelectedNode(node);
  };

  const handleRotate = () => {
    setRotationAngle((prev) => (prev + 30) % 360);
  };

  const stats = {
    total: filteredMappings.length,
    equivalent: filteredMappings.filter((m) => m.equivalence === "equivalent")
      .length,
    wider: filteredMappings.filter((m) => m.equivalence === "wider").length,
    narrower: filteredMappings.filter((m) => m.equivalence === "narrower")
      .length,
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-lg font-medium text-gray-700">
            Loading concept mappings...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center space-y-4">
        <AlertCircle className="w-10 h-10 text-red-500" />
        <p className="text-gray-600">{error}</p>
        <Button onClick={fetchConceptMappings}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  return (
      <div className="min-h-screen w-full ">
        {/* Header */}

        <div className=" mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Stats Bar */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold">{stats.total}</div>
                <div className="text-sm text-muted-foreground">
                  Total Mappings
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold text-green-600">
                  {stats.equivalent}
                </div>
                <div className="text-sm text-muted-foreground">Equivalent</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold text-blue-600">
                  {stats.wider}
                </div>
                <div className="text-sm text-muted-foreground">Wider</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold text-orange-600">
                  {stats.narrower}
                </div>
                <div className="text-sm text-muted-foreground">Narrower</div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Controls Panel */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Controls</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Search */}
                <div className="flex items-center space-x-2">
                  <Search className="w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="Search codes..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>

                {/* Category Filter */}
                <div className="flex items-center space-x-2">
                  <Filter className="w-4 h-4 text-gray-400" />
                  <Select
                    value={selectedCategory}
                    onValueChange={setSelectedCategory}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((category) => (
                        <SelectItem key={category} value={category}>
                          {category === "all" ? "All Categories" : category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Rotate */}
                <Button
                  variant="outline"
                  onClick={handleRotate}
                  className="w-full flex items-center space-x-2"
                >
                  <Shuffle className="w-4 h-4" />
                  <span>Rotate Layout</span>
                </Button>
              </CardContent>
            </Card>

            {/* Visualization */}
            <div className="lg:col-span-3">
              <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div className="p-4 border-b bg-gray-50">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Circular Network Visualization
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Live data from FHIR ConceptMap • Hover nodes to highlight
                    connections
                  </p>
                </div>

                <div className="p-6">
                  <div className="w-full aspect-square">
                    <ForceDirectedGraph
                      data={filteredMappings}
                      width={900}
                      height={900}
                      onNodeClick={handleNodeClick}
                      selectedNode={selectedNode}
                      rotationAngle={rotationAngle}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
      </div>
  );
};

export default NAMASTEToDashboard;
