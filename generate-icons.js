const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, 'assets');

async function generateIcons() {
    try {
        console.log('🎯 Starting icon generation...');

        // Read the original icon
        const iconPath = path.join(assetsDir, 'icon-original.png');
        if (!fs.existsSync(iconPath)) {
            console.error('❌ Error: icon-original.png not found in assets folder');
            console.error('Please save the logo image as assets/icon-original.png first');
            process.exit(1);
        }

        // 1. Generate main icon.png (1024x1024)
        console.log('📦 Generating icon.png (1024x1024)...');
        await sharp(iconPath)
            .resize(1024, 1024, { fit: 'contain', background: { r: 230, g: 244, b: 254 } })
            .png()
            .toFile(path.join(assetsDir, 'icon.png'));
        console.log('✅ icon.png created');

        // 2. Generate favicon.png (192x192)
        console.log('📦 Generating favicon.png (192x192)...');
        await sharp(iconPath)
            .resize(192, 192, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
            .png()
            .toFile(path.join(assetsDir, 'favicon.png'));
        console.log('✅ favicon.png created');

        // 3. Generate android-icon-foreground.png (1080x1080) - the main logo
        console.log('📦 Generating android-icon-foreground.png (1080x1080)...');
        await sharp(iconPath)
            .resize(1080, 1080, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
            .png()
            .toFile(path.join(assetsDir, 'android-icon-foreground.png'));
        console.log('✅ android-icon-foreground.png created');

        // 4. Generate android-icon-background.png (1080x1080) - solid color background
        console.log('📦 Generating android-icon-background.png (1080x1080)...');
        await sharp({
                create: {
                    width: 1080,
                    height: 1080,
                    channels: 3,
                    background: { r: 230, g: 244, b: 254 }
                }
            })
            .png()
            .toFile(path.join(assetsDir, 'android-icon-background.png'));
        console.log('✅ android-icon-background.png created');

        // 5. Generate android-icon-monochrome.png (1080x1080) - for themed icon
        console.log('📦 Generating android-icon-monochrome.png (1080x1080)...');
        await sharp(iconPath)
            .resize(1080, 1080, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
            .greyscale()
            .png()
            .toFile(path.join(assetsDir, 'android-icon-monochrome.png'));
        console.log('✅ android-icon-monochrome.png created');

        // 6. Generate splash-icon.png (512x512)
        console.log('📦 Generating splash-icon.png (512x512)...');
        await sharp(iconPath)
            .resize(512, 512, { fit: 'contain', background: { r: 230, g: 244, b: 254 } })
            .png()
            .toFile(path.join(assetsDir, 'splash-icon.png'));
        console.log('✅ splash-icon.png created');

        console.log('\n🎉 All icons generated successfully!');
        console.log('\n📋 Summary of generated files:');
        console.log('  • icon.png (1024x1024) - Main app icon');
        console.log('  • favicon.png (192x192) - Web favicon');
        console.log('  • android-icon-foreground.png (1080x1080) - Android adaptive icon foreground');
        console.log('  • android-icon-background.png (1080x1080) - Android adaptive icon background');
        console.log('  • android-icon-monochrome.png (1080x1080) - Android themed icon');
        console.log('  • splash-icon.png (512x512) - Splash screen icon');
        console.log('\n✨ Your logo is ready for APK and web builds!');
        console.log('Run: expo build:android or eas build --platform android for APK');

    } catch (error) {
        console.error('❌ Error generating icons:', error.message);
        process.exit(1);
    }
}

generateIcons();