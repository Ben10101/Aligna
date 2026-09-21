const fs = require('fs');
const path = require('path');

function fixOptionalChaining(dirPath) {
    const files = fs.readdirSync(dirPath, { recursive: true });
    let fixed = 0;

    files.forEach(file => {
        if (file.endsWith('.js')) {
            const fullPath = path.join(dirPath, file);
            try {
                let content = fs.readFileSync(fullPath, 'utf8');
                const original = content;
                content = content.replace(/\?\s+\./g, '?.');
                content = content.replace(/\?\s+\?/g, '??');

                if (content !== original) {
                    fs.writeFileSync(fullPath, content, 'utf8');
                    fixed++;
                    console.log('Fixed: ' + file);
                }
            } catch (e) {
                // skip binary files
            }
        }
    });

    return fixed;
}

const backendSrc = 'c:\\Projetos\\timeDev\\backend\\src';
const count = fixOptionalChaining(backendSrc);
console.log(`\nTotal files fixed: ${count}`);