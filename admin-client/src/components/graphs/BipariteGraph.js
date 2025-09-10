"use client"
import React, { useRef, useEffect } from "react";
import * as d3 from "d3";

const BipartiteGraph = ({
  data = [],
  width = 1200,
  height = 800,
  onNodeClick = null,
  selectedNode = null
}) => {
  const svgRef = useRef();

  const getEquivalenceColor = (equivalence) => {
    switch (equivalence) {
      case "equivalent": return "#10b981";
      case "wider": return "#3b82f6";
      case "narrower": return "#f59e0b";
      default: return "#6b7280";
    }
  };

  useEffect(() => {
    if (!data.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    svg.attr("viewBox", [0, 0, width, height])
      .style("width", "100%")
      .style("height", "100%")
      .style("background", "linear-gradient(to bottom right, #f9fafb, #ffffff)");

    const nodesMap = new Map();
    const links = [];

    data.forEach((d) => {
      const namasteId = `namaste-${d.namasteCode}`;
      const icdId = `icd11-${d.icd11Code}`;

      if (!nodesMap.has(namasteId)) {
        nodesMap.set(namasteId, {
          id: namasteId,
          code: d.namasteCode,
          display: d.namasteDisplay,
          type: "namaste"
        });
      }

      if (!nodesMap.has(icdId)) {
        nodesMap.set(icdId, {
          id: icdId,
          code: d.icd11Code,
          display: d.icd11Display,
          type: "icd11"
        });
      }

      links.push({
        source: namasteId,
        target: icdId,
        equivalence: d.equivalence
      });
    });

    const nodes = Array.from(nodesMap.values());

    // Separate NAMASTE and ICD-11 into two columns
    const namasteNodes = nodes.filter(n => n.type === "namaste");
    const icdNodes = nodes.filter(n => n.type === "icd11");

    // Vertical spacing
    const namasteY = d3.scalePoint()
      .domain(namasteNodes.map(d => d.id))
      .range([50, height - 50]);

    const icdY = d3.scalePoint()
      .domain(icdNodes.map(d => d.id))
      .range([50, height - 50]);

    // Assign positions
    namasteNodes.forEach((n, i) => {
      n.x = 200;
      n.y = namasteY(n.id);
    });

    icdNodes.forEach((n, i) => {
      n.x = width - 200;
      n.y = icdY(n.id);
    });

    const container = svg.append("g");

    // Zoom
    svg.call(d3.zoom()
      .scaleExtent([0.4, 3])
      .on("zoom", (event) => {
        container.attr("transform", event.transform);
      })
    );

    // Links
    container.append("g")
      .attr("stroke-opacity", 0.6)
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("x1", d => nodesMap.get(d.source).x)
      .attr("y1", d => nodesMap.get(d.source).y)
      .attr("x2", d => nodesMap.get(d.target).x)
      .attr("y2", d => nodesMap.get(d.target).y)
      .attr("stroke", d => getEquivalenceColor(d.equivalence))
      .attr("stroke-width", d =>
        d.equivalence === "equivalent" ? 2.5 :
        d.equivalence === "wider" ? 2 : 1.5
      );

    // Nodes
    container.append("g")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("cx", d => d.x)
      .attr("cy", d => d.y)
      .attr("r", d => d.type === "namaste" ? 7 : 6)
      .attr("fill", d => d.type === "namaste" ? "#f97316" : "#3b82f6")
      .attr("stroke", d => d.id === selectedNode?.id ? "#111827" : "#ffffff")
      .attr("stroke-width", d => d.id === selectedNode?.id ? 3 : 1)
      .style("cursor", "pointer")
      .on("click", (event, d) => {
        if (onNodeClick) onNodeClick(d);
      });

    // Labels
    container.append("g")
      .selectAll("text")
      .data(nodes)
      .join("text")
      .attr("x", d => d.type === "namaste" ? d.x - 12 : d.x + 12)
      .attr("y", d => d.y + 4)
      .attr("text-anchor", d => d.type === "namaste" ? "end" : "start")
      .attr("font-size", "10px")
      .attr("fill", "#374151")
      .text(d => d.code);
  }, [data, width, height, selectedNode]);

  return (
    <svg
      ref={svgRef}
      className="w-full h-full border border-gray-200 rounded-lg"
    />
  );
};

export default BipartiteGraph;
