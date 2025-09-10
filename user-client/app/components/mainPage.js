"use client"

import { useState } from 'react';
import { Home, View, Search, ArrowLeftRight, ScrollText } from 'lucide-react';
import AutoCompleteSearch from '../AutoCompleteSearch/page';
import NamasteCode from '../NamasteCode/page';
import NamasteToICD11TM2 from '../NamasteToIDC11TM2/page';
import NamasteToICD11Bio from '../NamasteToICD11Bio/page';
import Feedback from '../Feedback/page';
import HomePage from '../HomePage/page';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('homepage');

  const sidebarItems = [
    { id: 'homepage', label: 'Home', icon: Home },
    { id: 'view', label: 'View Namaste Code', icon: View },
    { id: 'map1', label: 'Namaste Code To ICD TM-2', icon: ArrowLeftRight },
    { id: 'map2', label: 'Namaste Code To ICD Bio', icon: ArrowLeftRight },
    { id: 'model', label: 'Search Namaste Code', icon: Search },
    { id: 'feedback', label: 'Feedback / Query', icon: ScrollText },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'homepage':
        return <HomePage />;
      case 'view':
        return <NamasteCode />;
      case 'map1':
        return <NamasteToICD11TM2 />;
      case 'map2':
        return <NamasteToICD11Bio />;
      case 'model':
        return <AutoCompleteSearch />;
      case 'feedback':
        return <Feedback />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Navbar */}
      <nav className="bg-white shadow-sm border-b w-full fixed top-0 left-0 h-15 z-10">
        <div className="px-6 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <h1 className="text-xl font-bold text-gray-900">AYUSHMAN</h1>
            </div>
          </div>
        </div>
      </nav>

      <div className="flex">
        {/* Sidebar */}
        <div className="w-90 bg-white shadow-sm border-r h-[100vh] fixed top-15 left-0">
          <div className="p-4">
            <nav className="space-y-2">
              {sidebarItems.map((item) => {
                const IconComponent = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-left transition-colors ${
                      activeTab === item.id
                        ? 'bg-blue-100 text-blue-700 border border-blue-200'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <IconComponent size={20} />
                    <span className="font-medium">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 p-6 mt-15">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}