-- =============================================================================
-- Phase 1 — Seed: permission catalogue, default roles, settings, species/breeds.
-- The full permission catalogue is seeded now so later modules only need policies.
-- =============================================================================

insert into public.permissions (key, module, action, label, is_sensitive, sort_order) values
  -- Dashboard
  ('dashboard.owner',        'dashboard',     'owner',    'Owner command center & alert center', true, 10),
  -- Customers
  ('customers.view',         'customers',     'view',     'View customers', false, 100),
  ('customers.create',       'customers',     'create',   'Create customers', false, 101),
  ('customers.edit',         'customers',     'edit',     'Edit customers', false, 102),
  ('customers.delete',       'customers',     'delete',   'Delete customers', true, 103),
  ('customers.merge',        'customers',     'merge',    'Merge duplicate customers', true, 104),
  -- Pets
  ('pets.view',              'pets',          'view',     'View pets', false, 200),
  ('pets.create',            'pets',          'create',   'Register pets', false, 201),
  ('pets.edit',              'pets',          'edit',     'Edit pets', false, 202),
  ('pets.delete',            'pets',          'delete',   'Delete pets', true, 203),
  -- Appointments & queue
  ('appointments.view',      'appointments',  'view',     'View appointments', false, 300),
  ('appointments.manage',    'appointments',  'manage',   'Book / reschedule / cancel appointments', false, 301),
  ('queue.manage',           'queue',         'manage',   'Check-in and move patients through the queue', false, 310),
  -- Clinical
  ('clinical.view',          'clinical',      'view',     'View medical records', true, 400),
  ('clinical.create',        'clinical',      'create',   'Write consultations & observations', true, 401),
  ('clinical.edit',          'clinical',      'edit',     'Edit draft medical records', true, 402),
  ('clinical.finalize',      'clinical',      'finalize', 'Finalize medical records', true, 403),
  ('clinical.reopen',        'clinical',      'reopen',   'Reopen / revise finalized records', true, 404),
  ('vaccinations.manage',    'vaccinations',  'manage',   'Record vaccinations', true, 410),
  ('prescriptions.manage',   'prescriptions', 'manage',   'Write prescriptions', true, 420),
  ('diagnostics.manage',     'diagnostics',   'manage',   'Order & report diagnostics', true, 430),
  ('surgery.manage',         'surgery',       'manage',   'Manage surgeries', true, 440),
  ('inpatient.manage',       'inpatient',     'manage',   'Manage admissions', true, 450),
  -- Billing
  ('billing.view',           'billing',       'view',     'View invoices & payments', false, 500),
  ('billing.create',         'billing',       'create',   'Create invoices & take payments', false, 501),
  ('billing.discount',       'billing',       'discount', 'Give discounts', true, 502),
  ('billing.discount_approve','billing',      'approve',  'Approve large discounts & deferred dues', true, 503),
  ('billing.refund',         'billing',       'refund',   'Issue refunds & reversals', true, 504),
  ('billing.void',           'billing',       'void',     'Void invoices', true, 505),
  -- Store
  ('pos.use',                'pos',           'use',      'Use pet store POS', false, 600),
  ('pos.return',             'pos',           'return',   'Process store returns', true, 601),
  -- Inventory & purchasing
  ('inventory.view',         'inventory',     'view',     'View stock', false, 700),
  ('inventory.manage',       'inventory',     'manage',   'Manage products & receive stock', false, 701),
  ('inventory.adjust',       'inventory',     'adjust',   'Adjust / write off stock', true, 702),
  ('inventory.view_cost',    'inventory',     'cost',     'See purchase cost & margins', true, 703),
  ('suppliers.manage',       'suppliers',     'manage',   'Suppliers & purchase orders', false, 710),
  -- Finance
  ('expenses.view',          'expenses',      'view',     'View expenses', true, 800),
  ('expenses.manage',        'expenses',      'manage',   'Record expenses', true, 801),
  ('finance.view',           'finance',       'view',     'See revenue, receivables & financial reports', true, 810),
  -- CRM & tasks
  ('crm.view',               'crm',           'view',     'View reminders & communications', false, 900),
  ('crm.manage',             'crm',           'manage',   'Send messages & manage reminders', false, 901),
  ('crm.campaigns',          'crm',           'campaigns','Run promotional campaigns', true, 902),
  ('tasks.view_all',         'tasks',         'view_all', 'See everyone''s tasks', false, 910),
  ('tasks.manage',           'tasks',         'manage',   'Create & assign tasks', false, 911),
  -- Reports
  ('reports.view',           'reports',       'view',     'Operational reports', false, 1000),
  ('reports.financial',      'reports',       'financial','Financial reports & analytics', true, 1001),
  ('data.export',            'data',          'export',   'Export data to Excel/CSV', true, 1010),
  -- Administration
  ('staff.view',             'staff',         'view',     'View staff & roles', false, 1100),
  ('staff.manage',           'staff',         'manage',   'Manage staff, roles & permissions', true, 1101),
  ('settings.manage',        'settings',      'manage',   'Clinic configuration', true, 1110),
  ('audit.view',             'audit',         'view',     'View audit log', true, 1120);

insert into public.roles (key, name, description, is_system) values
  ('owner',          'Owner / Admin',          'Full access to everything', true),
  ('senior_doctor',  'Senior Doctor',          'Clinical lead with finalize/reopen rights', true),
  ('junior_doctor',  'Junior Doctor',          'Clinical workflows; cannot reopen finalized records', true),
  ('intern',         'Intern',                 'Assist on assigned cases; record observations', true),
  ('reception',      'Reception / Front Desk', 'Customers, pets, appointments, queue, payments', true),
  ('store_staff',    'Store Staff',            'Pet store POS and stock lookup', true),
  ('inventory',      'Inventory / Pharmacy',   'Products, stock, suppliers and purchasing', true),
  ('manager',        'Finance / Manager',      'Operations, finance and reporting', true);

-- Owner: everything.
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r cross join public.permissions p where r.key = 'owner';

insert into public.role_permissions (role_id, permission_key)
select r.id, x.perm
from public.roles r
join (values
  ('senior_doctor', array['customers.view','customers.create','customers.edit','pets.view','pets.create','pets.edit',
     'appointments.view','appointments.manage','queue.manage','clinical.view','clinical.create','clinical.edit',
     'clinical.finalize','clinical.reopen','vaccinations.manage','prescriptions.manage','diagnostics.manage',
     'surgery.manage','inpatient.manage','billing.view','billing.create','billing.discount','inventory.view',
     'crm.view','crm.manage','tasks.view_all','tasks.manage','reports.view','staff.view']),
  ('junior_doctor', array['customers.view','customers.create','customers.edit','pets.view','pets.create','pets.edit',
     'appointments.view','appointments.manage','queue.manage','clinical.view','clinical.create','clinical.edit',
     'clinical.finalize','vaccinations.manage','prescriptions.manage','diagnostics.manage','surgery.manage',
     'inpatient.manage','billing.view','inventory.view','crm.view','tasks.manage','staff.view']),
  ('intern',        array['customers.view','pets.view','appointments.view','clinical.view','clinical.create',
     'inventory.view','tasks.manage']),
  ('reception',     array['customers.view','customers.create','customers.edit','pets.view','pets.create','pets.edit',
     'appointments.view','appointments.manage','queue.manage','billing.view','billing.create','crm.view','crm.manage',
     'tasks.manage','staff.view']),
  ('store_staff',   array['customers.view','customers.create','pets.view','pos.use','inventory.view','tasks.manage']),
  ('inventory',     array['inventory.view','inventory.manage','inventory.adjust','inventory.view_cost',
     'suppliers.manage','tasks.manage','reports.view']),
  ('manager',       array['dashboard.owner','customers.view','customers.create','customers.edit','customers.merge',
     'pets.view','appointments.view','appointments.manage','queue.manage','billing.view','billing.create',
     'billing.discount','billing.discount_approve','billing.refund','pos.use','pos.return','inventory.view',
     'inventory.manage','inventory.adjust','inventory.view_cost','suppliers.manage','expenses.view',
     'expenses.manage','finance.view','crm.view','crm.manage','crm.campaigns','tasks.view_all','tasks.manage',
     'reports.view','reports.financial','data.export','staff.view'])
) as m(role_key, perms) on m.role_key = r.key
cross join lateral unnest(m.perms) as x(perm);

insert into public.system_settings (key, value, description) values
  ('clinic.profile', jsonb_build_object(
      'name', 'Bin Dawood Animal Hospital',
      'tagline', '',
      'address', '',
      'city', 'Lahore',
      'phone', '',
      'whatsapp', '',
      'email', '',
      'website', ''
   ), 'Name and contact details printed on invoices, prescriptions and certificates'),
  ('clinic.locale', jsonb_build_object(
      'currency', 'PKR',
      'currency_symbol', 'Rs.',
      'timezone', 'Asia/Karachi',
      'country', 'PK',
      'date_format', 'dd MMM yyyy'
   ), 'Regional settings'),
  ('clinic.hours', jsonb_build_object(
      'mon', jsonb_build_array(jsonb_build_array('10:00','22:00')),
      'tue', jsonb_build_array(jsonb_build_array('10:00','22:00')),
      'wed', jsonb_build_array(jsonb_build_array('10:00','22:00')),
      'thu', jsonb_build_array(jsonb_build_array('10:00','22:00')),
      'fri', jsonb_build_array(jsonb_build_array('10:00','13:00'), jsonb_build_array('14:30','22:00')),
      'sat', jsonb_build_array(jsonb_build_array('10:00','22:00')),
      'sun', jsonb_build_array(jsonb_build_array('12:00','20:00'))
   ), 'Opening hours (Friday prayer break by default) — edit to match the clinic'),
  ('customers.fields', jsonb_build_object(
      'require_area', false,
      'referral_sources', jsonb_build_array('Walk-in','Referral','Google','Instagram','Facebook','TikTok','Returning','Other')
   ), 'Customer form configuration');

-- Species & breeds commonly seen in Lahore clinics. Fully editable in Settings.
insert into public.species (name, name_ur, sort_order) values
  ('Dog', 'کتا', 1), ('Cat', 'بلی', 2), ('Bird', 'پرندہ', 3), ('Rabbit', 'خرگوش', 4),
  ('Goat', 'بکری', 5), ('Sheep', 'بھیڑ', 6), ('Cow', 'گائے', 7), ('Buffalo', 'بھینس', 8),
  ('Horse', 'گھوڑا', 9), ('Hamster / Guinea pig', null, 10), ('Turtle', 'کچھوا', 11), ('Other', 'دیگر', 99);

insert into public.breeds (species_id, name)
select s.id, b.name
from public.species s
join (values
  ('Dog', array['Mixed / Desi','German Shepherd','Labrador Retriever','Golden Retriever','Siberian Husky',
                'Rottweiler','Doberman','Belgian Malinois','Pit Bull','American Bully','Bully Kutta','Gull Terrier',
                'Pointer','Shih Tzu','Pomeranian','Poodle','Pug','Beagle','Cocker Spaniel','Maltese','Chihuahua',
                'Great Dane','Alabai','Kurdish Kangal','Dalmatian']),
  ('Cat', array['Mixed / Desi','Persian','Himalayan','Siamese','British Shorthair','Scottish Fold','Maine Coon',
                'Ragdoll','Bengal','Exotic Shorthair','Turkish Angora']),
  ('Bird', array['Budgerigar (Budgie)','Cockatiel','Lovebird','African Grey','Ringneck','Alexandrine',
                 'Sun Conure','Macaw','Cockatoo','Eclectus','Finch','Pigeon','Chicken / Hen','Duck','Peacock']),
  ('Rabbit', array['Mixed','Lionhead','Holland Lop','Netherland Dwarf','Angora']),
  ('Goat', array['Beetal','Teddy','Kamori','Makhi Cheeni','Barbari','Nachi','Mixed']),
  ('Sheep', array['Kajli','Lohi','Salt Range','Mixed']),
  ('Cow', array['Sahiwal','Cholistani','Red Sindhi','Holstein Friesian','Cross-bred']),
  ('Buffalo', array['Nili-Ravi','Kundi','Mixed']),
  ('Horse', array['Mixed','Arabian','Thoroughbred'])
) as m(species, names) on m.species = s.name
cross join lateral unnest(m.names) as b(name);
