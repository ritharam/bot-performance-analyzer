# Change Log: Reverted "Business Strategic" Version

The following changes were implemented in the latest update but have been **reverted** in the current stable version to restore original functionality.

## Reverted UI/UX Changes
*   **Pillar-Based Renaming**: The technical "Bucket" terminology was renamed to business-centric pillars:
    *   *Service Expansion* (Reverted to Bucket 1).
    *   *System Optimization* (Reverted to Bucket 2).
    *   *Information Gaps* (Reverted to Bucket 3).
*   **Executive PDF Mode**: A "Customer Presentation" print mode that reformatted the dashboard into a white-labeled strategic document was removed.
*   **Print-Specific Styles**: Specialized CSS for page breaks and hiding navigation elements during PDF generation was removed.

## Reverted Export Functionality
*   **Developer-Centric Excel Logic**: The export logic that separated "Business ROI" rows from "Technical Root Cause" columns was reverted to the standard technical summary format.
*   **Strategic Priority Tooling**: The UI logic that color-coded tabs based on business impact scores (Rose/Amber/Emerald) was reset to the standard Indigo theme.

## Reason for Reversion
The "Business Strategic" update removed direct access to some raw debugging fields and technical labels required by the development team for day-to-day bot maintenance. The current version restores the technical "Auditor" focus.
