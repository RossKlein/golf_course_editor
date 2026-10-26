python -m venv .venv
cd web
npm install
npm run build

cd ..

.\.venv\Scripts\python.exe -m course_maker serve