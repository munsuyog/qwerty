// src/components/admin/FeedbackAdmin.jsx
"use client";

import React, { useEffect, useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { 
  Search, 
  Filter, 
  RefreshCw, 
  Mail, 
  User, 
  MessageSquare, 
  Clock,
  CheckCircle,
  AlertCircle,
  XCircle,
  Circle,
  Calendar,
  Send,
  Edit3
} from "lucide-react";

const FeedbackAdmin = () => {
  const [feedbacks, setFeedbacks] = useState([]);
  const [filteredFeedbacks, setFilteredFeedbacks] = useState([]);
  const [selectedFeedback, setSelectedFeedback] = useState(null);
  const [statusUpdate, setStatusUpdate] = useState("");
  const [responseText, setResponseText] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  const AUTH_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;
  const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL;

  const statusConfig = {
    open: { 
      label: "Open", 
      icon: Circle, 
      color: "bg-blue-100 text-blue-800 border-blue-200",
      dotColor: "bg-blue-500"
    },
    "in-progress": { 
      label: "In Progress", 
      icon: Clock, 
      color: "bg-yellow-100 text-yellow-800 border-yellow-200",
      dotColor: "bg-yellow-500"
    },
    resolved: { 
      label: "Resolved", 
      icon: CheckCircle, 
      color: "bg-green-100 text-green-800 border-green-200",
      dotColor: "bg-green-500"
    },
    closed: { 
      label: "Closed", 
      icon: XCircle, 
      color: "bg-gray-100 text-gray-800 border-gray-200",
      dotColor: "bg-gray-500"
    },
  };

  const fetchFeedbacks = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/feedback`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });
      const data = await res.json();
      const feedbackData = data.feedbacks || data;
      setFeedbacks(feedbackData);
      setFilteredFeedbacks(feedbackData);
    } catch (err) {
      console.error("Failed to fetch feedbacks", err);
    } finally {
      setIsLoading(false);
    }
  };

  const openModal = (feedback) => {
    setSelectedFeedback(feedback);
    setStatusUpdate(feedback.status);
    setResponseText(feedback.response || "");
    setModalOpen(true);
  };

  const updateStatus = async () => {
    if (!selectedFeedback) return;
    setIsUpdating(true);
    try {
      await fetch(`${BASE_URL}/feedback/${selectedFeedback.id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
        body: JSON.stringify({ status: statusUpdate, updatedBy: "admin" }),
      });
      await fetchFeedbacks();
      setModalOpen(false);
    } catch (err) {
      console.error("Failed to update status", err);
    } finally {
      setIsUpdating(false);
    }
  };

  const addResponse = async () => {
    if (!selectedFeedback) return;
    setIsUpdating(true);
    try {
      await fetch(`${BASE_URL}/feedback/${selectedFeedback.id}/response`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
        body: JSON.stringify({ response: responseText, respondedBy: "admin" }),
      });
      await fetchFeedbacks();
      setModalOpen(false);
    } catch (err) {
      console.error("Failed to add response", err);
    } finally {
      setIsUpdating(false);
    }
  };

  // Filter and search functionality
  useEffect(() => {
    let filtered = feedbacks;

    // Filter by status
    if (statusFilter !== "all") {
      filtered = filtered.filter(fb => fb.status === statusFilter);
    }

    // Filter by search term
    if (searchTerm) {
      filtered = filtered.filter(fb => 
        fb.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        fb.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        fb.query.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    setFilteredFeedbacks(filtered);
  }, [feedbacks, searchTerm, statusFilter]);

  useEffect(() => {
    fetchFeedbacks();
  }, []);

  const getStatusCounts = () => {
    return {
      all: feedbacks.length,
      open: feedbacks.filter(fb => fb.status === "open").length,
      "in-progress": feedbacks.filter(fb => fb.status === "in-progress").length,
      resolved: feedbacks.filter(fb => fb.status === "resolved").length,
      closed: feedbacks.filter(fb => fb.status === "closed").length,
    };
  };

  const statusCounts = getStatusCounts();

  const StatusBadge = ({ status }) => {
    const config = statusConfig[status] || statusConfig.open;
    const Icon = config.icon;
    
    return (
      <Badge variant="outline" className={`${config.color} font-medium`}>
        <div className={`w-2 h-2 rounded-full ${config.dotColor} mr-2`}></div>
        <Icon className="w-3 h-3 mr-1" />
        {config.label}
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <RefreshCw className="w-6 h-6 animate-spin text-gray-500" />
        <span className="ml-2 text-gray-500">Loading feedbacks...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="container mx-auto p-6 space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
            Feedback Admin Panel
          </h1>
          <p className="text-slate-600">Manage and respond to customer feedback</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {Object.entries(statusCounts).map(([status, count]) => (
            <Card key={status} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-slate-900">{count}</div>
                <div className="text-sm text-slate-600 capitalize">
                  {status === "all" ? "Total" : status.replace("-", " ")}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Search and Filter Bar */}
        <Card className="shadow-sm">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search by name, email, or message..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="flex gap-3">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-40">
                    <Filter className="w-4 h-4 mr-2" />
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="in-progress">In Progress</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
                <Button 
                  variant="outline" 
                  onClick={fetchFeedbacks}
                  disabled={isLoading}
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Feedback Cards */}
        {filteredFeedbacks.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <MessageSquare className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No feedbacks found</h3>
              <p className="text-gray-500">
                {searchTerm || statusFilter !== "all" 
                  ? "Try adjusting your search or filter criteria."
                  : "No feedback submissions yet."
                }
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredFeedbacks.map((fb) => (
              <Card
                key={fb.id}
                className="cursor-pointer hover:shadow-lg hover:scale-[1.02] transition-all duration-200 group"
                onClick={() => openModal(fb)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-2">
                      <User className="w-4 h-4 text-gray-500" />
                      <CardTitle className="text-lg font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                        {fb.name}
                      </CardTitle>
                    </div>
                    <StatusBadge status={fb.status} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center text-sm text-gray-600">
                      <Mail className="w-4 h-4 mr-2" />
                      {fb.email}
                    </div>
                    <div className="bg-gray-50 p-3 rounded-lg">
                      <p className="text-sm text-gray-700 line-clamp-3">
                        {fb.query}
                      </p>
                    </div>
                    {fb.createdAt && (
                      <div className="flex items-center text-xs text-gray-500">
                        <Calendar className="w-3 h-3 mr-1" />
                        {new Date(fb.createdAt).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Enhanced Modal */}
        {selectedFeedback && (
          <Dialog open={modalOpen} onOpenChange={setModalOpen}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto">
              <DialogHeader>
                <DialogTitle className="text-2xl font-bold text-gray-900 flex items-center">
                  <MessageSquare className="w-6 h-6 mr-2 text-blue-600" />
                  Feedback Details
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-6 py-4">
                {/* Feedback Information */}
                <div className="bg-gray-50 p-4 rounded-lg space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label className="text-sm font-medium text-gray-500">Name</Label>
                      <p className="text-gray-900 font-medium">{selectedFeedback.name}</p>
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-gray-500">Email</Label>
                      <p className="text-gray-900">{selectedFeedback.email}</p>
                    </div>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-500">Current Status</Label>
                    <div className="mt-1">
                      <StatusBadge status={selectedFeedback.status} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-500">Message</Label>
                    <div className="mt-2 p-3 bg-white border rounded-lg">
                      <p className="text-gray-900 whitespace-pre-wrap">{selectedFeedback.query}</p>
                    </div>
                  </div>
                  {selectedFeedback.response && (
                    <div>
                      <Label className="text-sm font-medium text-gray-500">Current Response</Label>
                      <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-gray-900 whitespace-pre-wrap">{selectedFeedback.response}</p>
                      </div>
                    </div>
                  )}
                </div>

                <Separator />

                {/* Admin Actions */}
                <Tabs defaultValue="status" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="status" className="flex items-center">
                      <Edit3 className="w-4 h-4 mr-2" />
                      Update Status
                    </TabsTrigger>
                    <TabsTrigger value="response" className="flex items-center">
                      <Send className="w-4 h-4 mr-2" />
                      Add Response
                    </TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="status" className="space-y-4 mt-4">
                    <div>
                      <Label className="text-sm font-medium">Change Status</Label>
                      <Select value={statusUpdate} onValueChange={setStatusUpdate}>
                        <SelectTrigger className="mt-2">
                          <SelectValue placeholder="Select new status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Open</SelectItem>
                          <SelectItem value="in-progress">In Progress</SelectItem>
                          <SelectItem value="resolved">Resolved</SelectItem>
                          <SelectItem value="closed">Closed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button 
                      onClick={updateStatus} 
                      className="w-full"
                      disabled={isUpdating || statusUpdate === selectedFeedback.status}
                    >
                      {isUpdating ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          Updating...
                        </>
                      ) : (
                        <>
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Update Status
                        </>
                      )}
                    </Button>
                  </TabsContent>
                  
                  <TabsContent value="response" className="space-y-4 mt-4">
                    <div>
                      <Label className="text-sm font-medium">Response Message</Label>
                      <Textarea
                        value={responseText}
                        onChange={(e) => setResponseText(e.target.value)}
                        placeholder="Type your response here..."
                        rows={4}
                        className="mt-2"
                      />
                    </div>
                    <Button 
                      onClick={addResponse} 
                      className="w-full"
                      disabled={isUpdating || !responseText.trim()}
                    >
                      {isUpdating ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4 mr-2" />
                          Send Response
                        </>
                      )}
                    </Button>
                  </TabsContent>
                </Tabs>
              </div>

              <DialogFooter>
                <Button 
                  variant="outline" 
                  onClick={() => setModalOpen(false)}
                  disabled={isUpdating}
                >
                  Close
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
};

export default FeedbackAdmin;