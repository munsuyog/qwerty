"use client";

import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function AutoCompleteSearch() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedData, setSelectedData] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

  const debounceRef = useRef(null);

  // Fetch suggestions
  const searchAutoComplete = async (searchQuery) => {
    if (!searchQuery.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setIsLoading(true);

    try {
      const response = await axios.post(
        "http://localhost:8000/query",
        {
          query: searchQuery,
          top_k: 5,
          include_full_rows: false,
        },
        {
          headers: { "Content-Type": "application/json" },
        }
      );

      const data = response.data;

      let results = [];
      if (data.exact_matches?.length > 0) {
        results = data.exact_matches;
      } else if (data.semantic_matches?.length > 0) {
        results = data.semantic_matches;
      }

      setSuggestions(results);
      setShowSuggestions(true);
    } catch (error) {
      console.error("Error fetching suggestions:", error);
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle input with debounce
  const handleInputChange = (e) => {
    const value = e.target.value;
    setQuery(value);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      searchAutoComplete(value);
    }, 300);
  };

  // Handle suggestion click
  const handleSuggestionClick = (suggestion) => {
    setSelectedData(suggestion);
    setShowDetails(true);
    setShowSuggestions(false);
    setQuery(suggestion.NAMC_CODE || suggestion.NAMC_term || "Selected Item");
  };

  const handleBack = () => {
    setShowDetails(false);
    setSelectedData(null);
    setQuery("");
    setSuggestions([]);
  };

  // Render single suggestion
  const renderSuggestion = (s, idx) => (
    <div
      key={idx}
      onClick={() => handleSuggestionClick(s)}
      className="px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100"
    >
      <div className="flex items-center justify-between">
        <div className="font-medium text-blue-600">{s.NAMC_CODE}</div>
        {s["NAMC _term_DEVANAGARI"] && (
          <div className="text-lg text-gray-700">{s["NAMC _term_DEVANAGARI"]}</div>
        )}
      </div>
      {s.NAMC_term && (
        <div className="text-sm font-medium text-gray-900 mt-1">{s.NAMC_term}</div>
      )}
      {s.short_definition && (
        <div className="text-xs text-gray-600 mt-1">{s.short_definition}</div>
      )}
    </div>
  );

  // Details View
  if (showDetails && selectedData) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Button variant="outline" onClick={handleBack} className="mb-6">
          ← Back to Search
        </Button>

        <Card>
          <CardContent className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold">{selectedData.NAMC_term}</h1>
                {selectedData["NAMC _term_DEVANAGARI"] && (
                  <p className="text-xl text-gray-700 mt-2">
                    {selectedData["NAMC _term_DEVANAGARI"]}
                  </p>
                )}
              </div>
              {selectedData.NAMC_CODE && (
                <div className="text-lg font-mono text-blue-600 bg-blue-50 px-3 py-2 rounded">
                  {selectedData.NAMC_CODE}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {selectedData.NAMC_CODE && (
                <div className="bg-gray-50 p-4 rounded">
                  <strong className="block text-gray-700">NAMC Code:</strong>
                  <p className="font-mono">{selectedData.NAMC_CODE}</p>
                </div>
              )}
              {selectedData.NAMC_term && (
                <div className="bg-gray-50 p-4 rounded">
                  <strong className="block text-gray-700">Term:</strong>
                  <p>{selectedData.NAMC_term}</p>
                </div>
              )}
              {selectedData["NAMC _term_diacritical"] && (
                <div className="bg-gray-50 p-4 rounded">
                  <strong className="block text-gray-700">Diacritical:</strong>
                  <p>{selectedData["NAMC _term_diacritical"]}</p>
                </div>
              )}

              {selectedData["NAMC _term_DEVANAGARI"] && (
                    <div className="bg-gray-50 p-4 rounded-lg">
                        <strong className="text-gray-700 block mb-1">Devanagari:</strong>
                        <p className="text-gray-900 text-lg">{selectedData["NAMC _term_DEVANAGARI"]}</p>
                    </div>
           )}
            </div>

            {selectedData.short_definition && selectedData.short_definition.trim() && (
              <div className="bg-blue-50 p-4 rounded">
                <strong className="block text-gray-700">Short Definition:</strong>
                <p>{selectedData.short_definition}</p>
              </div>
            )}

            {selectedData.long_definition && selectedData.long_definition.trim() && (
              <div className="bg-green-50 p-4 rounded">
                <strong className="block text-gray-700">Long Definition:</strong>
                <p className="whitespace-pre-wrap">
                  {selectedData.long_definition}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Search View
  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-2">NAMC Search</h1>
      <p className="text-gray-600 mb-6">
        Search for NAMC terms and explore Ayurvedic diagnostic conditions
      </p>

      <div className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-2 h-5 w-5 text-gray-400" />
          <Input
            value={query}
            onChange={handleInputChange}
            placeholder="Search NAMC terms..."
            className="pl-10 pr-10"
            onFocus={() => setShowSuggestions(suggestions.length > 0)}
          />
          {isLoading && (
            <Loader2 className="absolute right-3 top-3 h-5 w-5 text-gray-400 animate-spin" />
          )}
        </div>

        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow max-h-80 overflow-y-auto">
            {suggestions.map((s, idx) => renderSuggestion(s, idx))}
          </div>
        )}

        {showSuggestions && suggestions.length === 0 && query && !isLoading && (
          <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow p-4 text-center text-gray-500">
            No results for "{query}"
          </div>
        )}
      </div>

        {/* Instructions */} 
        <div className="mt-8 text-sm text-gray-600"> 
            <p>• Type to search for NAMC terms (e.g., "ayu", "hikka", "parighah")</p> 
            <p>• Exact matches will be prioritized over semantic matches</p> 
            <p>• Click on any suggestion to view detailed information</p> 
        </div>
        
    </div>
  );
}
