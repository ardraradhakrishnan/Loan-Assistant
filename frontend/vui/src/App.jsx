import React, { useState } from "react";
import MicSection from "./components/MicSection";
import UserDataPanel from "./components/UserDataPanel";
import AnalysisPanel from "./components/AnalysisPanel";

function App() {
  const [userData, setUserData] = useState({});
  const [analysis, setAnalysis] = useState({});
  // const [conversation, setConversation] = useState([]);
  const [, setConversation] = useState([]);

  // Function to update user data dynamically
  const handleUserDataUpdate = (newData) => {
    setUserData((prev) => ({ ...prev, ...newData }));
  };

  // Function to update analysis dynamically
  const handleAnalysisUpdate = (newAnalysis) => {
    setAnalysis(newAnalysis);
  };

  // Function to add conversation messages (optional)
  const addConversation = (msg) => {
    setConversation((prev) => [...prev, msg]);
  };

  // Check if userData has any non-null values
  const hasUserData = Object.values(userData).some(value => value !== null && value !== undefined && value !== "");

  return (
    <div className="container-fluid vh-100 p-3">
      <div className="row h-100">
        {/* Left Panel - User Data (only render when data exists) */}
        {hasUserData && (
          <div className="col-md-3 border-end overflow-auto">
            <UserDataPanel userData={userData} />
          </div>
        )}

        {/* Middle Panel - Mic */}
        <div className={`${hasUserData ? 'col-md-6' : 'col-md-12'} d-flex flex-column align-items-center justify-content-center`}>
          <MicSection 
            onUserDataUpdate={handleUserDataUpdate} 
            onAnalysisUpdate={handleAnalysisUpdate}
            addConversation={addConversation}
          />
        </div>

        {/* Right Panel - Analysis / Calculations */}
        {hasUserData && (
          <div className="col-md-3 border-start overflow-auto">
            <AnalysisPanel analysis={analysis} />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
