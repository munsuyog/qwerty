"use client"
import React, { useRef, useEffect } from "react";
import * as d3 from "d3";

const ForceDirectedGraph = ({
  data = [],
  width = 1000,
  height = 800,
  onNodeClick = null,
  selectedNode = null
}) => {
  const svgRef = useRef();
  const simulationRef = useRef();
  const nodesRef = useRef([]);
  const linksRef = useRef([]);

  const getEquivalenceColor = (equivalence) => {
    switch (equivalence) {
      case "equivalent": return "#10b981";
      case "wider": return "#3b82f6";
      case "narrower": return "#f59e0b";
      default: return "#6b7280";
    }
  };

  const getCategoryColor = (category) => {
    const colors = {
      "Dosha Disorders": "#ef4444",
      "Symptomatic": "#8b5cf6",
      "Digestive": "#06b6d4",
      "Neurological": "#ec4899",
      "Dermatological": "#84cc16",
      "Metabolic": "#f97316",
      "Musculoskeletal": "#6366f1",
      "Psychiatric": "#f43f5e",
      "Sensory": "#14b8a6",
      "Reproductive": "#a855f7",
    };
    return colors[category] || "#6b7280";
  };

  useEffect(() => {
    if (!data.length) return;

    const svg = d3.select(svgRef.current);
    
    // Only clear if this is the first render or if we don't have existing nodes
    const isFirstRender = !simulationRef.current;
    
    if (isFirstRender) {
      svg.selectAll("*").remove();
    }

    svg.attr("viewBox", [0, 0, width, height])
      .style("width", "100%")
      .style("height", "100%")
      .style("background", "linear-gradient(to bottom right, #f9fafb, #ffffff)");

    // Prepare nodes and links
    const nodesMap = new Map();
    const links = [];

    data.forEach((d) => {
      const namasteId = `namaste-${d.namasteCode}`;
      const icdId = `icd11-${d.icd11Code}`;

      if (!nodesMap.has(namasteId)) {
        const nodeData = {
          id: namasteId,
          code: d.namasteCode,
          display: d.namasteDisplay,
          type: "namaste",
          category: d.category || "General"
        };
        
        // Preserve existing positions if available
        const existingNode = nodesRef.current.find(n => n.id === namasteId);
        if (existingNode) {
          nodeData.x = existingNode.x;
          nodeData.y = existingNode.y;
          nodeData.vx = existingNode.vx || 0;
          nodeData.vy = existingNode.vy || 0;
        }
        
        nodesMap.set(namasteId, nodeData);
      }

      if (!nodesMap.has(icdId)) {
        const nodeData = {
          id: icdId,
          code: d.icd11Code,
          display: d.icd11Display,
          type: "icd11",
          category: d.category || "General"
        };
        
        // Preserve existing positions if available
        const existingNode = nodesRef.current.find(n => n.id === icdId);
        if (existingNode) {
          nodeData.x = existingNode.x;
          nodeData.y = existingNode.y;
          nodeData.vx = existingNode.vx || 0;
          nodeData.vy = existingNode.vy || 0;
        }
        
        nodesMap.set(icdId, nodeData);
      }

      links.push({
        source: namasteId,
        target: icdId,
        equivalence: d.equivalence
      });
    });

    const nodes = Array.from(nodesMap.values());
    nodesRef.current = nodes;
    linksRef.current = links;

    let container, link, node, label;

    if (isFirstRender) {
      // Create new simulation and elements only on first render
      const simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).id(d => d.id).distance(80))
        .force("charge", d3.forceManyBody().strength(-150))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(20));

      simulationRef.current = simulation;

      container = svg.append("g");

      // Zoom
      svg.call(d3.zoom()
        .scaleExtent([0.2, 3])
        .on("zoom", (event) => {
          container.attr("transform", event.transform);
        })
      );

      // Links
      link = container.append("g")
        .attr("stroke-opacity", 0.5)
        .selectAll("line")
        .data(links)
        .join("line")
        .attr("stroke", d => getEquivalenceColor(d.equivalence))
        .attr("stroke-width", d =>
          d.equivalence === "equivalent" ? 2.5 :
          d.equivalence === "wider" ? 2 : 1.5
        );

      // Nodes
      node = container.append("g")
        .selectAll("circle")
        .data(nodes)
        .join("circle")
        .attr("r", d => d.type === "namaste" ? 7 : 5)
        .attr("fill", d => d.type === "namaste" ? "#f97316" : "#3b82f6")
        .attr("stroke", d => getCategoryColor(d.category))
        .attr("stroke-width", 2)
        .style("cursor", "pointer")
        .on("click", (event, d) => {
          if (onNodeClick) onNodeClick(d);
        })
        .on("mouseover", function (event, d) {
          d3.select(this).attr("r", d.type === "namaste" ? 12 : 9);

          link.attr("stroke-opacity", l =>
            l.source.id === d.id || l.target.id === d.id ? 1 : 0.1
          );

          node.attr("opacity", n =>
            n.id === d.id ||
            links.some(l =>
              (l.source.id === d.id && l.target.id === n.id) ||
              (l.target.id === d.id && l.source.id === n.id)
            ) ? 1 : 0.3
          );
        })
        .on("mouseout", function () {
          d3.select(this).attr("r", d => d.type === "namaste" ? 7 : 5);
          link.attr("stroke-opacity", 0.5);
          node.attr("opacity", 1);
        });

      // Labels
      label = container.append("g")
        .selectAll("text")
        .data(nodes)
        .join("text")
        .text(d => d.code)
        .attr("font-size", "9px")
        .attr("fill", "#374151")
        .attr("text-anchor", "middle")
        .style("pointer-events", "none");

      simulation.on("tick", () => {
        link
          .attr("x1", d => d.source.x)
          .attr("y1", d => d.source.y)
          .attr("x2", d => d.target.x)
          .attr("y2", d => d.target.y);

        node
          .attr("cx", d => d.x)
          .attr("cy", d => d.y);

        label
          .attr("x", d => d.x)
          .attr("y", d => d.y - 10);
      });

      // Store references for future updates
      simulationRef.current.linkSelection = link;
      simulationRef.current.nodeSelection = node;
      simulationRef.current.labelSelection = label;
    } else {
      // Update existing simulation and elements
      const simulation = simulationRef.current;
      
      // Update simulation with new data but preserve positions
      simulation.nodes(nodes);
      simulation.force("link").links(links);
      
      // Update link data
      link = simulationRef.current.linkSelection;
      link.data(links, d => `${d.source.id}-${d.target.id}`)
        .join("line")
        .attr("stroke", d => getEquivalenceColor(d.equivalence))
        .attr("stroke-width", d =>
          d.equivalence === "equivalent" ? 2.5 :
          d.equivalence === "wider" ? 2 : 1.5
        );

      // Update node data
      node = simulationRef.current.nodeSelection;
      node.data(nodes, d => d.id)
        .join("circle")
        .attr("r", d => d.type === "namaste" ? 7 : 5)
        .attr("fill", d => d.type === "namaste" ? "#f97316" : "#3b82f6")
        .attr("stroke", d => getCategoryColor(d.category))
        .attr("stroke-width", 2)
        .style("cursor", "pointer")
        .on("click", (event, d) => {
          if (onNodeClick) onNodeClick(d);
        })
        .on("mouseover", function (event, d) {
          d3.select(this).attr("r", d.type === "namaste" ? 12 : 9);

          link.attr("stroke-opacity", l =>
            l.source.id === d.id || l.target.id === d.id ? 1 : 0.1
          );

          node.attr("opacity", n =>
            n.id === d.id ||
            links.some(l =>
              (l.source.id === d.id && l.target.id === n.id) ||
              (l.target.id === d.id && l.source.id === n.id)
            ) ? 1 : 0.3
          );
        })
        .on("mouseout", function () {
          d3.select(this).attr("r", d => d.type === "namaste" ? 7 : 5);
          link.attr("stroke-opacity", 0.5);
          node.attr("opacity", 1);
        });

      // Update label data
      label = simulationRef.current.labelSelection;
      label.data(nodes, d => d.id)
        .join("text")
        .text(d => d.code)
        .attr("font-size", "9px")
        .attr("fill", "#374151")
        .attr("text-anchor", "middle")
        .style("pointer-events", "none");

      // Restart simulation with low alpha to minimize movement
      simulation.alpha(0.1).restart();
    }

    // Handle selected node highlighting
    if (selectedNode && node) {
      node.filter(d => d.id === selectedNode.id)
        .attr("stroke-width", 4)
        .attr("stroke", "#111827");
    }

    return () => {
      if (simulationRef.current) {
        simulationRef.current.stop();
      }
    };
  }, [data, width, height, selectedNode]);

  return (
    <svg
      ref={svgRef}
      className="w-full h-full border border-gray-200 rounded-lg"
    />
  );
};

export default ForceDirectedGraph;