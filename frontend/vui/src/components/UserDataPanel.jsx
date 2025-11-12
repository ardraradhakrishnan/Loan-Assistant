import React from "react";

export default function UserDataPanel({ userData }) {
  // Format field names for better display
  const formatFieldName = (fieldName) => {
    const nameMap = {
      first_name: "First Name",
      date_of_birth: "Date of Birth", 
      monthly_salary: "Monthly Salary",
      phone_number: "Phone Number",
      email_address: "Email Address"
    };
    return nameMap[fieldName] || fieldName.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  // Format field values for better display
  const formatFieldValue = (fieldName, value) => {
    if (!value) return "Not collected";
    
    switch (fieldName) {
      case "monthly_salary":
        return `₹${value.toLocaleString()}`;
      case "date_of_birth":
        return value; // Keep as DD-MM-YYYY
      case "phone_number":
        // Format phone number if it's 10 digits
        if (value.length === 10) {
          return `${value.slice(0,5)} ${value.slice(5)}`;
        }
        return value;
      case "email_address":
        return value.toLowerCase();
      default:
        return value;
    }
  };

  // Define the order of fields to display
  const fieldOrder = [
    "first_name",
    "date_of_birth", 
    "monthly_salary",
    "phone_number",
    "email_address"
  ];

  // Check if any data has been collected
  const hasData = Object.values(userData).some(value => value !== null && value !== undefined && value !== "");

  return (
    <div>
      <h4 className="mb-3">Collected Data</h4>
      {!hasData ? (
        <p>No data collected yet.</p>
      ) : (
        <ul className="list-group">
          {fieldOrder.map((field) => {
            const value = userData[field];
            // Only render list item if field has data
            if (!value) return null;
            
            return (
              <li key={field} className="list-group-item d-flex justify-content-between">
                <strong>{formatFieldName(field)}</strong>
                <span>{formatFieldValue(field, value)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}