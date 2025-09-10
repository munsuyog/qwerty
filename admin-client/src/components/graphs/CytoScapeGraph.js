"use client"
import CytoscapeComponent from "react-cytoscapejs";

const CytoGraph = ({ data }) => {
  const elements = [
    // nodes
    ...data.map(d => ({
      data: { id: `namaste-${d.namasteCode}`, label: d.namasteCode, type: "namaste" }
    })),
    ...data.map(d => ({
      data: { id: `icd11-${d.icd11Code}`, label: d.icd11Code, type: "icd11" }
    })),
    // edges
    ...data.map(d => ({
      data: {
        source: `namaste-${d.namasteCode}`,
        target: `icd11-${d.icd11Code}`,
        equivalence: d.equivalence
      }
    }))
  ];

  return (
    <CytoscapeComponent
      elements={elements}
      style={{ width: "100%", height: "800px" }}
      layout={{ name: "cose", animate: true }}
      stylesheet={[
        {
          selector: "node[type='namaste']",
          style: { "background-color": "#f97316", label: "data(label)" }
        },
        {
          selector: "node[type='icd11']",
          style: { "background-color": "#3b82f6", label: "data(label)" }
        },
        {
          selector: "edge",
          style: { "line-color": "#9ca3af", "target-arrow-shape": "triangle" }
        }
      ]}
    />
  );
};

export default CytoGraph;