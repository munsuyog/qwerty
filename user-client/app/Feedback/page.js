"use client";

import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CheckCircle2, PlusCircle } from "lucide-react";

export default function Feedback() {
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm();

  const [feedbacks, setFeedbacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Fetch feedback list
  useEffect(() => {
    const fetchFeedbacks = async () => {
      try {
        const res = await fetch(
          "http://localhost:3001/feedback/",
          {
            headers: { "ngrok-skip-browser-warning": 69420 },
          }
        );
        const data = await res.json();
        if (data.success) {
          setFeedbacks(data.feedbacks);
        }
      } catch (err) {
        console.error("Error fetching feedbacks:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchFeedbacks();
  }, []);

  // Submit new feedback
  const onSubmit = async (data) => {
    setSubmitting(true);
    setSuccess(false);
    const payload = {
      name: data.name,
      email: data.email,
      namasteCode: data.namasteCode,
      icd11Code: data.icd11Code,
      query: data.feedback,
    };

    try {
      const res = await fetch("http://localhost:3001/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": 69420,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`Failed: ${res.status}`);

      const updated = await res.json();
      setFeedbacks((prev) => [updated, ...prev]);
      reset();
      setSuccess(true);

      // hide message after 3 sec
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error("Error submitting feedback:", err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-8xl mx-auto p-6 ml-100">
      {/* Create Feedback Button → Opens Modal */}
      <Dialog>
        <DialogTrigger asChild>
          <Button className="mb-6"><PlusCircle size={20}/> Create Feedback / Query</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Submit Feedback / Query</DialogTitle>
          </DialogHeader>

          {success && (
            <div className="flex items-center gap-2 p-3 mb-3 rounded-lg bg-green-100 text-green-800">
              <CheckCircle2 className="w-5 h-5" />
              <span>Feedback submitted successfully!</span>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Form Fields ... same as before */}
            <div>
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                placeholder="Your name"
                {...register("name", { required: "Name is required" })}
              />
              {errors.name && (
                <p className="text-sm text-red-600">{errors.name.message}</p>
              )}
            </div>

            <div>
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                {...register("email", {
                  required: "Email is required",
                  pattern: {
                    value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                    message: "Enter a valid email",
                  },
                })}
              />
              {errors.email && (
                <p className="text-sm text-red-600">{errors.email.message}</p>
              )}
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <Label htmlFor="namasteCode">Namaste Code</Label>
                <Input
                  id="namasteCode"
                  placeholder="e.g. AA.001"
                  {...register("namasteCode")}
                />
              </div>
              <div className="flex-1">
                <Label htmlFor="icd11Code">ICD-11 Code</Label>
                <Input
                  id="icd11Code"
                  placeholder="e.g. TM2.A0"
                  {...register("icd11Code")}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="feedback">Feedback / Query *</Label>
              <Textarea
                id="feedback"
                rows={4}
                placeholder="Write your feedback or query..."
                {...register("feedback", { required: "Feedback is required" })}
              />
              {errors.feedback && (
                <p className="text-sm text-red-600">{errors.feedback.message}</p>
              )}
            </div>

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Submitting..." : "Submit"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Feedback Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Feedbacks</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p>Loading...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Namaste Code</TableHead>
                  <TableHead>ICD-11 Code</TableHead>
                  <TableHead>Query</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {feedbacks.map((fb) => (
                  <TableRow key={fb._id}>
                    <TableCell>{fb.name}</TableCell>
                    <TableCell>{fb.email}</TableCell>
                    <TableCell>{fb.codes?.namaste || "-"}</TableCell>
                    <TableCell>{fb.codes?.icd11 || "-"}</TableCell>
                    <TableCell className="max-w-xs whitespace-pre-wrap break-words">
                        {fb.query}
                    </TableCell>
                    <TableCell>{fb.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
