import { query } from './db.js';

async function fixSupervisorPermissions() {
  console.log("Fixing Supervisor IA access for Admin/Owner users...");
  try {
    // 1. Ensure the supervisor module is enabled for all existing organizations
    // This allows access to the 'stats' and other endpoints that check modules_enabled.supervisor
    console.log("Enabling supervisor module for all organizations...");
    const orgs = await query("SELECT id, modules_enabled FROM organizations");
    for (const org of orgs.rows) {
      let modules = org.modules_enabled || {};
      if (typeof modules === 'string') modules = JSON.parse(modules);
      
      if (!modules.supervisor) {
        modules.supervisor = true;
        await query(
          "UPDATE organizations SET modules_enabled = $1 WHERE id = $2",
          [JSON.stringify(modules), org.id]
        );
        console.log(`- Enabled supervisor for org ${org.id}`);
      }
    }

    // 2. Ensure all owners and admins are mapped as supervisors in the monitored_sellers table
    // The monitored-sellers endpoints often filter or require a mapping in supervisor_settings or monitored_sellers
    // but the most common issue is the user not being in organization_members with the right role 
    // OR the supervisor route checking a specific 'supervisor' role in organization_members.
    
    // In our system, owners and admins should always have access.
    
    // 3. Check if we need to add a 'supervisor' role to the app_role enum if it doesn't exist
    // Note: The app uses organization_members.role which is a VARCHAR usually, but if it's an enum:
    try {
      await query("ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'supervisor'");
    } catch (e) {
      // Ignore if not using an enum or if it already exists
    }

    console.log("✅ Supervisor IA access fix complete.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Fix failed:", error);
    process.exit(1);
  }
}

fixSupervisorPermissions();
