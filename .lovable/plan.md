# Plan - Fix Survey 404 and Implement Wizard/Gallery

The user is experiencing a 404 error when accessing public survey links (e.g., `/api/external-forms/public/pesquisa-ud3lb7`). Although some fixes were applied to the allowed `display_mode`, the existing surveys in the database might still be failing due to missing `is_active` status or slug mismatches. Additionally, the user wants a Wizard for creating surveys and a template gallery.

## Proposed Changes

### 1. Fix Survey 404 (High Priority)
- **Database Diagnostic & Repair**: Check for surveys with `display_mode = 'survey'` and ensure they have `is_active = true` and `slug` correctly set.
- **Backend (`backend/src/routes/external-forms.js`)**: Add more logging to the `public/:slug` route to identify why a specific slug fails (e.g., if the lowercase comparison is failing or if the UUID fallback is interfering).
- **Backend (`backend/src/routes/surveys.js`)**: Ensure all new surveys are explicitly created with `is_active = true`.

### 2. Survey Creation Wizard
- **Frontend (`src/components/surveys/SurveyWizard.tsx`)**: Create a multi-step modal for survey creation.
    - Step 1: Basic Info (Name, Description, Logo).
    - Step 2: Questions (Add/Edit fields).
    - Step 3: Design (Colors, Transition Type).
- **Frontend (`src/pages/PesquisasSatisfacao.tsx`)**: Connect the "Nova Pesquisa" button to this new Wizard.

### 3. Template Gallery
- **Frontend (`src/components/surveys/TemplateGallery.tsx`)**: Create a gallery of pre-defined survey templates.
    - NPS (Net Promoter Score).
    - CSAT (Customer Satisfaction Score).
    - Event Feedback.
- **Action**: Add a "Clonar" (Clone) button to each template that seeds the Wizard with pre-filled data.

## Verification Plan

### Automated Tests
- Test public route `/api/external-forms/public/:slug` with a survey slug to ensure 200 OK.

### Manual Verification
1. Create a survey via "Criar com IA".
2. Click "Copiar Link" and open in a new tab.
3. Verify the survey loads correctly without 404.
4. Open the new "Nova Pesquisa" Wizard and complete all steps.
5. Clone a template from the gallery and verify it populates the editor.
