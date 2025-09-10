"use client";
import React, { useState } from "react";
import { usePathname } from "next/navigation"; // ✅ Import this
import { Button } from "../ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "../ui/sidebar";
import {
  LayoutDashboard,
  UploadCloud,
  RefreshCw,
  ClipboardList,
  Database,
  Map,
  BookOpen,
  Menu,
  Check
} from "lucide-react";

const items = [
  { title: "Home", url: "/", icon: LayoutDashboard },
  { title: "Upload NAMASTE", url: "/upload", icon: UploadCloud },
  { title: "Sync ICD-11", url: "/sync-icd", icon: RefreshCw },
  { title: "Audit", url: "/audit", icon: ClipboardList },
  { title: "ValueSet", url: "/valueset", icon: Database },
  { title: "ConceptMap", url: "/conceptmap", icon: Map },
  { title: "CodeSystem", url: "/codesystem", icon: BookOpen },
  { title: "Feedbacks", url: "/feedbacks", icon: Check },
];

const DashboardLayout = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const pathname = usePathname(); // ✅ Get current path safely

  return (
    <div className="flex h-screen w-full bg-gray-50">
      <div
        className={`sticky top-0 left-0 h-screen p-2 flex flex-col justify-between bg-white shadow-lg transition-all duration-300 ${
          sidebarOpen ? "w-64" : "w-20"
        }`}
      >
        <div className="flex items-center justify-between mb-4 px-2">
          <h2 className={`font-bold text-lg text-gray-800 ${sidebarOpen ? "block" : "hidden"}`}>
            Admin Panel
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1"
          >
            <Menu />
          </Button>
        </div>

        <Sidebar>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel className={`${sidebarOpen ? "block" : "hidden"} text-gray-500`}>
                Admin
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="space-y-1">
                  {items.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild>
                        <a
                          href={item.url}
                          className={`flex items-center gap-3 p-2 rounded-lg hover:bg-gray-100 transition-colors ${
                            pathname === item.url
                              ? "bg-blue-100 text-blue-700 font-semibold"
                              : "text-gray-700"
                          }`}
                        >
                          <item.icon className="w-5 h-5" />
                          <span className={`${sidebarOpen ? "block" : "hidden"}`}>{item.title}</span>
                        </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>

        <div className="px-2 mt-4">
          {sidebarOpen && <p className="text-xs text-gray-400 text-center">© 2025 Ministry of AYUSH</p>}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
};

export default DashboardLayout;
