import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

const CircularNetworkGraph = ({ 
  data = [], 
  width = 800, 
  height = 800, 
  onNodeClick = null,
  selectedNode = null,
  rotationAngle = 0 
}) => {
  const svgRef = useRef();

  const getEquivalenceColor = (equivalence) => {
    switch(equivalence) {
      case 'equivalent': return '#10b981';
      case 'wider': return '#3b82f6';
      case 'narrower': return '#f59e0b';
      default: return '#6b7280';
    }
  };

  const getCategoryColor = (category) => {
    const colors = {
      'Dosha Disorders': '#ef4444',
      'Symptomatic': '#8b5cf6',
      'Digestive': '#06b6d4',
      'Neurological': '#ec4899',
      'Dermatological': '#84cc16',
      'Metabolic': '#f97316',
      'Musculoskeletal': '#6366f1',
      'Psychiatric': '#f43f5e',
      'Sensory': '#14b8a6',
      'Reproductive': '#a855f7'
    };
    return colors[category] || '#6b7280';
  };

  useEffect(() => {
    if (!svgRef.current || !data.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const radius = Math.min(width, height) / 2 - 120;
    const centerX = width / 2;
    const centerY = height / 2;

    svg.attr("viewBox", `0 0 ${width} ${height}`)
       .style("width", "100%")
       .style("height", "100%");

    // Create all unique nodes
    const allCodes = new Set();
    data.forEach(d => {
      allCodes.add(JSON.stringify({
        id: `namaste-${d.namasteCode}`,
        code: d.namasteCode,
        display: d.namasteDisplay,
        type: 'namaste',
        category: d.category,
        mapping: d
      }));
      allCodes.add(JSON.stringify({
        id: `icd11-${d.icd11Code}`,
        code: d.icd11Code,
        display: d.icd11Display,
        type: 'icd11',
        category: d.category,
        mapping: d
      }));
    });

    const nodes = Array.from(allCodes).map(d => JSON.parse(d));
    
    // Position nodes in a circle
    nodes.forEach((node, i) => {
      const angle = (i / nodes.length) * 2 * Math.PI + (rotationAngle * Math.PI / 180);
      node.x = centerX + Math.cos(angle) * radius;
      node.y = centerY + Math.sin(angle) * radius;
      node.angle = angle;
    });

    const links = data.map(d => ({
      source: nodes.find(n => n.id === `namaste-${d.namasteCode}`),
      target: nodes.find(n => n.id === `icd11-${d.icd11Code}`),
      equivalence: d.equivalence,
      category: d.category
    })).filter(l => l.source && l.target);

    // Create main container
    const container = svg.append("g");

    // Create curved path generator
    const linkArc = (d) => {
      const dx = d.target.x - d.source.x;
      const dy = d.target.y - d.source.y;
      const dr = Math.sqrt(dx * dx + dy * dy);
      
      // Calculate sweep direction based on angles
      const sourceAngle = d.source.angle;
      const targetAngle = d.target.angle;
      let angleDiff = targetAngle - sourceAngle;
      
      // Normalize angle difference
      if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      
      const sweep = angleDiff > 0 ? 1 : 0;
      const radiusMultiplier = Math.abs(angleDiff) > Math.PI / 2 ? 0.8 : 0.4;
      
      return `M${d.source.x},${d.source.y}A${dr * radiusMultiplier},${dr * radiusMultiplier} 0 0,${sweep} ${d.target.x},${d.target.y}`;
    };

    // Create links
    const linkGroup = container.append("g").attr("class", "links");
    
    const link = linkGroup.selectAll("path")
      .data(links)
      .enter().append("path")
      .attr("d", linkArc)
      .attr("fill", "none")
      .attr("stroke", d => getEquivalenceColor(d.equivalence))
      .attr("stroke-width", d => {
        switch(d.equivalence) {
          case 'equivalent': return 2.5;
          case 'wider': return 2;
          case 'narrower': return 1.5;
          default: return 1;
        }
      })
      .attr("stroke-opacity", 0.6)
      .attr("class", "connection-link");

    // Create node groups
    const nodeGroup = container.append("g").attr("class", "nodes");
    
    const node = nodeGroup.selectAll("g")
      .data(nodes)
      .enter().append("g")
      .attr("class", "node")
      .attr("transform", d => `translate(${d.x}, ${d.y})`)
      .style("cursor", "pointer")
      .on("click", (event, d) => {
        if (onNodeClick) {
          onNodeClick(d);
        }
      })
      .on("mouseover", function(event, d) {
        // Highlight connected links
        link.style("stroke-opacity", l => 
          (l.source.id === d.id || l.target.id === d.id) ? 1 : 0.1)
          .style("stroke-width", l => {
            if (l.source.id === d.id || l.target.id === d.id) {
              switch(l.equivalence) {
                case 'equivalent': return 4;
                case 'wider': return 3.5;
                case 'narrower': return 3;
                default: return 2;
              }
            }
            return l.equivalence === 'equivalent' ? 2.5 : l.equivalence === 'wider' ? 2 : 1.5;
          });
        
        // Highlight connected nodes
        nodeGroup.selectAll("g").style("opacity", n => {
          if (n.id === d.id) return 1;
          return links.some(l => 
            (l.source.id === d.id && l.target.id === n.id) ||
            (l.target.id === d.id && l.source.id === n.id)
          ) ? 1 : 0.3;
        });
      })
      .on("mouseout", function() {
        link.style("stroke-opacity", 0.6)
            .style("stroke-width", l => l.equivalence === 'equivalent' ? 2.5 : l.equivalence === 'wider' ? 2 : 1.5);
        nodeGroup.selectAll("g").style("opacity", 1);
      });

    // Add circles for nodes
    node.append("circle")
        .attr("r", d => d.type === 'namaste' ? 8 : 6)
        .attr("fill", d => d.type === 'namaste' ? '#f97316' : '#3b82f6')
        .attr("stroke", d => getCategoryColor(d.category))
        .attr("stroke-width", 2.5)
        .attr("class", "node-circle");

    // Add outer ring for NAMASTE nodes
    node.filter(d => d.type === 'namaste')
        .append("circle")
        .attr("r", 12)
        .attr("fill", "none")
        .attr("stroke", d => getCategoryColor(d.category))
        .attr("stroke-width", 1)
        .attr("stroke-opacity", 0.3);

    // Highlight selected node
    if (selectedNode) {
      node.filter(d => d.id === selectedNode.id)
          .select("circle")
          .attr("stroke-width", 4)
          .attr("stroke-opacity", 1);
    }

    // Create labels group
    const labelGroup = container.append("g").attr("class", "labels");
    
    labelGroup.selectAll("text")
      .data(nodes)
      .enter().append("text")
      .attr("x", d => d.x)
      .attr("y", d => d.y)
      .attr("dx", d => {
        // Position labels outside the circle
        const angle = Math.atan2(d.y - centerY, d.x - centerX);
        return Math.cos(angle) * (d.type === 'namaste' ? 20 : 18);
      })
      .attr("dy", d => {
        const angle = Math.atan2(d.y - centerY, d.x - centerX);
        return Math.sin(angle) * (d.type === 'namaste' ? 20 : 18) + 4;
      })
      .style("text-anchor", d => {
        const angle = Math.atan2(d.y - centerY, d.x - centerX);
        return Math.cos(angle) > 0 ? "start" : "end";
      })
      .style("font-size", "9px")
      .style("font-weight", d => d.type === 'namaste' ? "bold" : "normal")
      .style("fill", "#374151")
      .style("pointer-events", "none")
      .text(d => {
        const maxLength = d.type === 'namaste' ? 15 : 18;
        const text = `${d.code}`;
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
      });

    // Add zoom functionality
    const zoom = d3.zoom()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => {
        container.attr("transform", event.transform);
      });

    svg.call(zoom);

    // Add title in center
    container.append("text")
      .attr("x", centerX)
      .attr("y", centerY - 10)
      .attr("text-anchor", "middle")
      .style("font-size", "16px")
      .style("font-weight", "bold")
      .style("fill", "#374151")
      .style("pointer-events", "none")
      .text("NAMASTE ↔ ICD-11 TM2");
    
    container.append("text")
      .attr("x", centerX)
      .attr("y", centerY + 10)
      .attr("text-anchor", "middle")
      .style("font-size", "12px")
      .style("fill", "#6b7280")
      .style("pointer-events", "none")
      .text(`${data.length} Mappings`);

  }, [data, width, height, rotationAngle, selectedNode]);

  return (
    <div className="w-full h-full">
      <svg 
        ref={svgRef}
        className="w-full h-full border border-gray-200 rounded-lg bg-gradient-to-br from-gray-50 to-white"
      />
    </div>
  );
};

export default CircularNetworkGraph;