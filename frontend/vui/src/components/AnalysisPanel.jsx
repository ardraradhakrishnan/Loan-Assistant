import React from "react";

export default function AnalysisPanel({ analysis }) {
  // Format field names for better display
  const formatFieldName = (fieldName) => {
    const nameMap = {
      eligible: "Eligibility Status",
      emi_amount: "Monthly EMI",
      max_eligible_amount: "Maximum Eligible Amount",
      loan_amount: "Requested Loan Amount",
      loan_tenure_years: "Loan Tenure",
      monthly_salary: "Monthly Salary",
      interest_rate: "Interest Rate",
      total_payable: "Total Payable Amount",
      total_interest: "Total Interest",
      reason: "Remarks"
    };
    return nameMap[fieldName] || fieldName.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  // Format field values for better display
  const formatFieldValue = (fieldName, value) => {
    if (value === null || value === undefined) return "Not available";
    
    switch (fieldName) {
      case "eligible":
        return value ? "✅ Eligible" : "❌ Not Eligible";
      case "emi_amount":
      case "max_eligible_amount":
      case "loan_amount":
      case "total_payable":
      case "total_interest":
        return `₹${value.toLocaleString()}`;
      case "monthly_salary":
        return `₹${value.toLocaleString()}`;
      case "interest_rate":
        return `${value}% per annum`;
      case "loan_tenure_years":
        return `${value} years`;
      default:
        return value.toString();
    }
  };

  // Define the order of fields to display
  const fieldOrder = [
    "eligible",
    "reason",
    "emi_amount", 
    "loan_amount",
    "max_eligible_amount",
    "monthly_salary",
    "loan_tenure_years",
    "interest_rate",
    "total_interest",
    "total_payable"
  ];

  return (
    <div>
      <h4 className="mb-3">Analysis </h4>
      {Object.keys(analysis).length === 0 ? (
        <p>No analysis yet.</p>
      ) : (
        <ul className="list-group">
          {fieldOrder.map((field) => {
            const value = analysis[field];
            // Only show fields that exist in the analysis data
            if (value === undefined) return null;
            
            return (
              <li key={field} className="list-group-item d-flex justify-content-between">
                <strong>{formatFieldName(field)}</strong>
                <span className={field === "eligible" ? (value ? "text-success" : "text-danger") : ""}>
                  {formatFieldValue(field, value)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}